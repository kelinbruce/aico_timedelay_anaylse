# workflow-llm-nodes Specification

## Purpose
定义 Workflow 模型节点的统一执行契约，包括路由、意图识别、问题改写、翻译、数据分析和参数提取节点，以及 `DATA_ANALYSIS` 可选 Python Capability 子调用的最终失败处置。

## Function

- **所属 Function**：`FN-9.7 执行模型节点`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格
## Requirements
### Requirement: Shared LLM Node Execution

Workflow engine MUST execute `llm-router`, `intent-recognition`, `question-rewriting`, `translation`, `data-analysis`, `param-extract` in a unified way without adjusting the Recipe YAML DSL.

当 `providerId=model-gateway` 且 workflow 模型选择返回 `MODEL_ID_NOT_ELIGIBLE` 时，engine MUST 使用已注册 Gateway model catalog 配置和请求的 `modelId` 进行 fallback 解析。fallback MUST 通过 `modelCatalog.get(registeredModelId)` 获取 Gateway 配置，并用请求的 `modelId` 覆盖配置中的 `modelId`。非 `model-gateway` provider 不进行此 fallback。

LLM node `inputs.model_params` MUST be processed by `modelParamsInferenceOptions` as follows:

1. Strip `enable_thinking` (boolean) and convert to `thinking.depth`:
   - `true` -> `"HIGH"`
   - `false` -> `"OFF"`
   - absent or non-boolean -> no `thinking` configuration
2. Place all remaining fields (including temperature, top_p, max_tokens, etc.) into `modelParams` as a single opaque `JsonObject`. When no remaining fields exist, `modelParams` MUST NOT be set.
3. When `model_params` is absent or not an object, `modelParamsInferenceOptions` MUST return `undefined`.

`mergeModelInferenceOptions` MUST shallow-merge `providerOptions`: top-level keys in the override replace same-named keys in the base, but keys only present in the base MUST be preserved. `modelParams` from the override replaces `modelParams` from the base (not merged). When both base and override have `undefined` for a field, the result MUST NOT include that field.

#### Scenario: enable_thinking true produces HIGH

- **GIVEN** a node's `model_params` contains `enable_thinking: true`
- **WHEN** `modelParamsInferenceOptions` processes the inputs
- **THEN** the returned `ModelInferenceOptions` MUST contain `thinking: { depth: "HIGH" }`

#### Scenario: enable_thinking false produces OFF

- **GIVEN** a node's `model_params` contains `enable_thinking: false`
- **WHEN** `modelParamsInferenceOptions` processes the inputs
- **THEN** the returned `ModelInferenceOptions` MUST contain `thinking: { depth: "OFF" }`

#### Scenario: enable_thinking absent produces no thinking

- **GIVEN** a node's `model_params` does not contain `enable_thinking`
- **WHEN** `modelParamsInferenceOptions` processes the inputs
- **THEN** the returned `ModelInferenceOptions` MUST NOT contain `thinking`

#### Scenario: Remaining fields pass through as modelParams

- **GIVEN** a node's `model_params` contains `temperature: 0.7` and `custom_param: "value"`
- **WHEN** `modelParamsInferenceOptions` processes the inputs
- **THEN** the returned `ModelInferenceOptions` MUST contain `modelParams` with `temperature: 0.7` and `custom_param: "value"`
- **AND** `temperature` MUST NOT appear as a canonical `ModelInferenceOptions` field

#### Scenario: mergeModelInferenceOptions shallow-merges providerOptions

- **GIVEN** base `ModelInferenceOptions` has `providerOptions: { key_a: "base" }`
- **AND** override `ModelInferenceOptions` has `providerOptions: { key_b: "override" }`
- **WHEN** `mergeModelInferenceOptions` merges them
- **THEN** the result `providerOptions` MUST contain both `key_a: "base"` and `key_b: "override"`

#### Scenario: mergeModelInferenceOptions modelParams override replaces base

- **GIVEN** base `ModelInferenceOptions` has `modelParams: { temperature: 0.5 }`
- **AND** override `ModelInferenceOptions` has `modelParams: { top_p: 0.9 }`
- **WHEN** `mergeModelInferenceOptions` merges them
- **THEN** the result `modelParams` MUST be `{ top_p: 0.9 }`

### Requirement: LLM Family Boundary

workflow LLM 节点 MUST 只 owner通用模型转换、分类、重写、翻译、分析和提取语义，不得与其他 workflow node families 的 owner 冲突。

#### Scenario: No Retrieval Or Side Effect Ownership
- **GIVEN** knowledge、capability、interaction families 分别 owner 检索/选择、外部 side effect、用户交互
- **WHEN** 实现 `llm-router`、`intent-recognition`、`question-rewriting`、`translation`、`data-analysis`、`param-extract`
- **THEN** LLM 节点 MUST NOT 直接执行知识检索、tool/API/python/agent side effect、pending input 或 display projection
- **AND** 需要这些能力时 MUST 通过上游/下游节点协作，而不是在 LLM family 内重建 owner

### Requirement: LLM Router

`llm-router` MUST 作为通用 LLM completion 节点工作，可用于路由判断、生成答案或生成结构化中间结果。

**触发机制：**
- 当 `llm-router` ready 时触发

**输入与前置条件：**
- 标准 Recipe YAML `inputs.prompt_template` 或 `inputs.prompt_template_name`
- 可选 `inputs.model` / `inputs.modelGroup` / `inputs.capability`
- 当前 `contextVariables`

**输出与副作用：**
- 根据 `outputs` 映射生成 safe output

**核心判断逻辑：**
1. 解析 prompt template 或 prompt template name
2. 选择模型 profile
3. 调用模型并解析结果
4. 将结果映射到声明的 output key

**失败与降级：**
- 缺失模板或模型配置 -> 明确失败

#### Scenario: Structured Mapping
- **WHEN** `llm-router` 配置了 output 映射
- **THEN** system MUST 将 safe 结果映射到声明的 output key

### Requirement: Intent Recognition

`intent-recognition` MUST 识别输入意图并输出安全的分类结果。

**触发机制：**
- 由调度器在节点 ready 时触发

**输入与前置条件：**
- 查询文本、候选意图集合、可选多轮上下文

**输出与副作用：**
- `intent`
- `confidence`

**核心判断逻辑：**
1. 组装分类 prompt
2. 调用模型
3. 校验 `confidence` 在 `0..1` 区间

**失败与降级：**
- confidence 不合法 -> validation 失败

#### Scenario: Confidence Validation
- **WHEN** 模型返回 `confidence`
- **THEN** 系统 MUST 校验其位于 `0..1`

### Requirement: Question Rewriting

`question-rewriting` MUST 将用户问题改写为更适合检索或后续推理的查询，同时保持关键电信术语不丢失。

**触发机制：**
- 在节点 ready 后触发

**输入与前置条件：**
- 原始问题
- 可选历史摘要、领域上下文

**输出与副作用：**
- `rewrittenQuery`

**核心判断逻辑：**
1. 读取原始问题和可选上下文
2. 执行改写
3. 检查关键术语保留约束

**失败与降级：**
- 无法生成安全改写 -> 返回明确失败或走 `onError`

#### Scenario: Preserve Telecom Terms
- **WHEN** 原始问题包含电信网元、告警码或专业术语
- **THEN** 改写结果 MUST 保留这些关键术语或其等价安全表达

### Requirement: Translation

`translation` MUST 按指定源语言和目标语言输出翻译结果。

**触发机制：**
- 节点 ready 时触发

**输入与前置条件：**
- `text`
- `sourceLang`
- `targetLang`

**输出与副作用：**
- `translatedText`

**核心判断逻辑：**
1. 校验输入文本非空
2. 组装翻译 prompt
3. 调用模型并输出 safe 文本

**失败与降级：**
- 不支持的语言对 -> 明确失败

#### Scenario: Translation Output
- **WHEN** 提供合法语言对
- **THEN** 系统 MUST 返回 `translatedText`

### Requirement: Data Analysis

`data-analysis` MUST 基于结构化数据和分析提示输出可消费的分析结果。

**触发机制：**
- 节点 ready 时触发

**输入与前置条件：**
- 结构化 `data`
- `analysisPrompt`

**输出与副作用：**
- `analysisResult`

**核心判断逻辑：**
1. 校验输入数据可序列化
2. 组装分析 prompt
3. 调用模型并返回 safe 分析结果

#### Scenario: Structured Data Analysis
- **WHEN** 输入结构化数据和分析提示
- **THEN** 系统 MUST 产出 `analysisResult`

### Requirement: Param Extract

`param-extract` MUST 从输入文本中提取符合 schema 的结构化参数。

**触发机制：**
- 节点 ready 时触发

**输入与前置条件：**
- 源文本
- `paramSchema`

**输出与副作用：**
- `extractedParams`

**核心判断逻辑：**
1. 组装参数提取 prompt
2. 调用模型
3. 将结果解析为 JSON
4. 依据 `paramSchema` 做 runtime validation

**状态 / 产物契约：**
- `extractedParams` 与原始文本保持可追溯关系，但只落地验证通过的结构

**失败与降级：**
- JSON 解析失败 / schema 校验失败 -> MUST 失败或重试，不得透传原始字符串

#### Scenario: Reject Invalid Structured Output
- **WHEN** 模型返回不符合 `paramSchema` 的结果
- **THEN** 系统 MUST 拒绝该结果，不得直接传给下游节点

### Requirement: DATA_ANALYSIS Python 子调用遵守统一失败处置

`DATA_ANALYSIS` 节点装配 Python Capability boundary 时，Python 子调用 MUST 使用可信 descriptor 和统一 `CapabilityInvocationResult`。`SUCCEEDED` 和合法 `DEGRADED` MUST 产生声明的数据分析结果；最终非取消 `FAILED` 或 `TIMED_OUT` MUST 保留 `safeError` 并上升为当前节点失败；`safeError.category=CANCELED` MUST 立即传播取消。

`DATA_ANALYSIS` 节点和 Workflow engine MUST NOT 因 Python Capability 最终失败而重新执行整个节点。节点声明的 retry 次数 MUST 通过 `CapabilityInvocationRequest.maxRetries` 约束 Python 子调用内部的额外 attempt 上限；未配置节点或 Recipe retry 时 MUST 使用 Capability 默认值 `1`。统一调用边界内部已经执行的安全瞬态重试是该子调用唯一的自动重试。

Python Capability boundary 完全未装配时，节点 MUST 只执行 model-only 路径；该路径未发生 Capability 调用，不得合成 Capability `safeError`。

**需求类别**：功能性需求

#### Scenario: Python 子调用最终失败

- **WHEN** `DATA_ANALYSIS` 的 Python Capability 返回最终 `FAILED`
- **THEN** 节点 MUST 保留该 Capability 的 `safeError`
- **AND** 节点 MUST 把失败交给 Workflow engine 求值显式 exception
- **AND** Workflow MUST NOT 自动重新执行整个 `DATA_ANALYSIS` 节点

#### Scenario: Python 子调用取消

- **WHEN** Python Capability 返回 `FAILED + safeError.category=CANCELED`
- **THEN** 节点 MUST 立即传播取消
- **AND** 节点 MUST NOT 求值 exception

#### Scenario: 未装配 Python boundary

- **WHEN** `DATA_ANALYSIS` 没有装配 Python Capability boundary
- **THEN** 节点 MUST 按 model-only 路径执行
- **AND** 系统 MUST NOT 创建伪造的 `CapabilityInvocationResult`
