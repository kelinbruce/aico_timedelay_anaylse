## ADDED Requirements

### Requirement: Workflow Template Engine

Workflow 引擎 MUST 提供独立的模板渲染模块，支持在任意字符串中展开控制流语法和变量引用。

**语法规范：**
- 循环：`{% for item in list %}` ... `{% endfor %}` -- item 为循环变量，list 为 scope 中的数组变量路径
- 条件：`{% if var.path %}` ... `{% endif %}` -- 变量值为 truthy 时渲染内容块
- 真值判断语义：空数组 `[]`、空对象 `{}`、空字符串 `""`、`0`、`null`、`undefined` 视为 falsy；其他值视为 truthy
- 不支持比较运算符（如 `===`、`>`），不支持 `{% else %}`
- for/if MUST 支持任意嵌套（for 内嵌 if、if 内嵌 for）
- 变量引用 MUST 同时支持两种语法：`` 和 `{{ var.path }}`
- 循环体内 MUST 能引用循环变量（`item.field`）和外部变量

**变量作用域：**
- scope 来源为 `context.variables`（workflow inputVariables + 所有前置节点 outputs 合并 + loop 注入变量）
- 模板引擎 MUST 只读访问 scope，不修改

**输入来源约束：**
- 模板引擎 MUST 作用于 `context.node.inputs` 的原始值，而非经过 `resolveNodeValue` 处理后的值
- 原因：`resolveNodeValue` 会递归替换 `` 占位符，导致模板中的循环变量引用被提前消耗

**变量语法与 PromptTemplateAssembler 的边界：**
- `assemblePrompt` 使用 `{{name}}` 语法替换 agent 元信息变量（如 `{{agentId}}`、`{{environment}}`），未知变量会抛 `TEMPLATE_VARIABLE_UNKNOWN`
- 模板引擎使用 `` 语法替换 workflow 变量（如 ``、``）
- 在 `prompt_template_name` 路径中，模板库内容引用 workflow 变量 MUST 使用 `` 语法，MUST NOT 使用 `{{ var }}` 语法

**安全约束：**
- 循环最大迭代数 MUST 不超过 10，超过时 MUST 抛 `TEMPLATE_LOOP_LIMIT_EXCEEDED`
- 未闭合的 `{% for %}` / `{% if %}` MUST 抛 `TEMPLATE_UNCLOSED_BLOCK`
- 未知语法 MUST 抛 `TEMPLATE_SYNTAX_ERROR`

**架构约束：**
- 模板引擎 MUST 作为独立模块实现，不耦合 `interpolateString`
- 暴露 `renderTemplate(template: string, scope: JsonObject): string` 函数
- 任意需要模板渲染的位置 MUST 通过此函数调用

#### Scenario: For Loop Expansion
- **GIVEN** scope 中 `alarms` = `[{name: "A1", severity: "critical"}, {name: "A2", severity: "warning"}]`
- **WHEN** 渲染模板 `{% for alarm in alarms %}告警：，级别：` `{% endfor %}`
- **THEN** 输出 MUST 为 `告警：A1，级别：critical` 和 `告警：A2，级别：warning`

#### Scenario: If With Empty Array Is Falsy
- **GIVEN** scope 中 `alarms` = `[]`
- **WHEN** 渲染模板 `{% if alarms %}有告警{% endif %}`
- **THEN** 输出 MUST 为空字符串

#### Scenario: If With NonEmpty Array Is Truthy
- **GIVEN** scope 中 `alarms` = `[{name: "A1"}]`
- **WHEN** 渲染模板 `{% if alarms %}有告警{% endif %}`
- **THEN** 输出 MUST 为 `有告警`

#### Scenario: Nested For/If
- **GIVEN** scope 中 `alarms` = `[{name: "A1", severity: "critical"}, {name: "A2", severity: "warning"}]`
- **WHEN** 渲染模板 `{% for alarm in alarms %}{% if alarm.severity %}告警：` `{% endif %}{% endfor %}`
- **THEN** 输出 MUST 包含两条告警（severity 均非空字符串，truthy）

#### Scenario: Loop Limit Exceeded
- **WHEN** 循环迭代数超过 10
- **THEN** MUST 抛 `TEMPLATE_LOOP_LIMIT_EXCEEDED`

#### Scenario: Unclosed Block
- **WHEN** 模板包含未闭合的 `{% for %}` 或 `{% if %}`
- **THEN** MUST 抛 `TEMPLATE_UNCLOSED_BLOCK`

### Requirement: LLM Node Stream Mode

LLM 节点 MUST 支持流式和非流式两种模型调用模式。

**模式控制（字符串比较）：**
- `inputs.is_stream = "true"` -> MUST 调用 `ModelInvocationService.stream()`
- `inputs.is_stream = "false"` -> MUST 调用 `ModelInvocationService.complete()`
- 未配置 `is_stream` 时：
  - 主 recipe 中，当前节点的 next 包含指向当前 recipe END 节点的路径 -> MUST 默认流式
  - 其他情况 -> MUST 默认非流式
- 子 recipe 内的节点 MUST NOT 触发默认流式行为

**主 recipe 判定：**
- 通过 `context.request.executionMetadata?.subRecipeDepth` 判定：未定义或为 0 即主 recipe
- 不新增 context 字段

**END 节点判定：**
- 从 `context.recipe.flowGraph.nodes` 中找到 `type === "END"` 的节点 ID
- 检查当前节点的 `next` 是否包含指向该 END 节点的 key
- 不新增 context 字段

**流式输出行为：**
- 流式 content MUST 通过 `emitOutputDelta({ channel: "CONTENT", content: delta, level: "ANSWER" })` 逐段发送
- 流式 reasoning MUST 通过 `emitOutputDelta({ channel: "THINKING", content: delta, level: "DETAIL" })` 逐段发送
- 流式输出 MUST 通过 `level` 字段触发 `WorkflowRuntimeEventProjector` 的 fast-path 走 `TOOL_STRUCTURED_DELTA` 投影
- 流式输出 MUST NOT 走 `LLM_CONTENT_DELTA` 投影路径
- 流式发送完毕后，完整输出 MUST 存入 `outputVariables`（`llm_completion` 和 `llm_result`），与非流式一致

#### Scenario: Stream Mode Via Input
- **GIVEN** LLM 节点配置 `inputs.is_stream = "true"`
- **WHEN** 节点执行
- **THEN** MUST 调用 `ModelInvocationService.stream()` 并逐段发送 content delta

#### Scenario: Default Stream For Last Main Recipe Node
- **GIVEN** 主 recipe 中 LLM 节点的 next 指向 END 节点
- **AND** 未配置 `is_stream`
- **WHEN** 节点执行
- **THEN** MUST 默认走流式模式

#### Scenario: No Default Stream In Sub Recipe
- **GIVEN** 子 recipe 中 LLM 节点的 next 指向子 recipe 的 END 节点
- **AND** 未配置 `is_stream`
- **WHEN** 节点执行
- **THEN** MUST 走非流式模式

### Requirement: LLM Output Bindings

LLM_ROUTER 和 LLM 节点 MUST 产出两个系统内置输出绑定：`llm_result` 和 `llm_completion`。两者的语义明确分离。

**llm_result — 模型原始输出对象：**
- `llm_result` MUST 为冻结对象，包含模型完整原始输出
- `content`：经过 `parseWorkflowLlmPayload` 处理的 content
- `reasoning`：来自 `modelResult.reasoning`，有值时 MUST 包含
- `toolCalls`：来自 `modelResult.toolCalls`，有值时 MUST 包含
- `finishReason`：来自 `modelResult.finishReason`，有值时 MUST 包含
- `usage`：来自 `modelResult.usage`，有值时 MUST 包含

**llm_completion — 提取的 content（受 result_with_think 控制）：**
- `result_with_think = "true"` 且 reasoning 存在时 -> `llm_completion` MUST 为 `{ content, reasoning }`
- 未配置或 `result_with_think = "false"` -> `llm_completion` MUST 为 `tryParseJsonContent(content)` （只包含 content）
- content MUST 自动尝试 `JSON.parse`（先 `stripJsonFence`）
- 解析成功 -> MUST 存 JSON 对象；解析失败 -> MUST 保留原始文本
- JSON 解析 MUST NOT 与 `outputSchema` 校验耦合

**消费约束：**
- recipe 下游需要模型回答内容时 MUST 引用 `${llm_completion}` 或 `${llm_completion.field}`
- recipe 下游需要推理过程时 MUST 引用 `${llm_result.reasoning}` 或配置 `result_with_think = "true"` 后引用 `${llm_completion.reasoning}`
- recipe 下游需要完整模型输出时 MUST 引用 `${llm_result}`

#### Scenario: llm_completion Is Only Content By Default
- **GIVEN** LLM 节点未配置 `result_with_think`
- **AND** 模型返回了 reasoning
- **WHEN** 输出 `llm_completion`
- **THEN** MUST 只包含 content（不含 reasoning）
- **AND** `llm_result` MUST 包含 `{ content, reasoning }`

#### Scenario: llm_completion Excludes Reasoning When result_with_think=false
- **GIVEN** LLM 节点配置 `result_with_think = "false"`
- **AND** 模型返回了 reasoning
- **WHEN** 输出 `llm_completion`
- **THEN** MUST 只包含 content
- **AND** `llm_result` MUST 仍包含 `{ content, reasoning }`

#### Scenario: llm_completion Includes Reasoning When result_with_think=true
- **GIVEN** LLM 节点配置 `result_with_think = "true"`
- **AND** 模型返回了 reasoning
- **WHEN** 输出 `llm_completion`
- **THEN** MUST 包含 `{ content, reasoning }`

#### Scenario: llm_result Contains Full Model Output
- **GIVEN** 模型返回 content、reasoning、toolCalls、finishReason、usage
- **WHEN** 输出 `llm_result`
- **THEN** MUST 包含全部字段：`{ content, reasoning, toolCalls, finishReason, usage }`

#### Scenario: Auto JSON Parse Success
- **GIVEN** 模型返回 content = `'{"answer": "yes"}'`
- **AND** 未配置 `outputSchema`
- **WHEN** 输出 `llm_completion`
- **THEN** MUST 为 JSON 对象 `{ answer: "yes" }`

#### Scenario: Auto JSON Parse Failure
- **GIVEN** 模型返回 content = `'This is a plain text answer.'`
- **WHEN** 输出 `llm_completion`
- **THEN** MUST 保留原始文本字符串

### Requirement: Prompt Generation Flow

LLM 节点 MUST 按以下优先级生成 prompt：

1. `prompt_template` 非空 -> 从 `context.node.inputs` 读取原始字符串，经模板引擎渲染后作为 systemPrompt
2. `prompt_template_name` 非空 -> 从 `context.node.inputs` 读取原始名称字符串，按 agentId + agentVersion 查询模板库，返回的 renderedContent 经模板引擎渲染后作为 systemPrompt
3. 均空 -> 使用 `context.variables` 中的 `query` / `question` 字段作为 userPrompt，无 systemPrompt

**原始值约束：**
- `prompt_template` 和 `prompt_template_name` MUST 从 `context.node.inputs` 的原始值读取
- MUST NOT 从经过 `resolveNodeValue` 处理后的 `resolvedInputs` 读取

**systemPrompt 渲染约束：**
- 路径 1 和 2 的 systemPrompt MUST 经过模板引擎渲染
- userPrompt 保持现有逻辑（`buildWorkflowLlmUserPrompt` 或 `inputVariables.query`），不经过模板引擎

**两层渲染边界（仅路径 2）：**
- `assemblePrompt` 负责 `{{name}}` agent 元信息变量替换
- 模板引擎负责 `` workflow 变量和控制流展开
- 模板库内容引用 workflow 变量 MUST 使用 `` 语法

**prompt_template_name 静态名称约束：**
- `prompt_template_name` 是静态名称字符串，MUST NOT 包含变量引用
- 需要动态模板选择时，MUST 通过 `prompt_template` + 模板引擎 `{% if %}` 实现

#### Scenario: Inline Template With Loop
- **GIVEN** `prompt_template` = `{% for alarm in alarms %}告警：` `{% endfor %}`
- **AND** scope 中 `alarms` = `[{name: "A1"}, {name: "A2"}]`
- **WHEN** 生成 prompt
- **THEN** systemPrompt MUST 为 `告警：A1` 和 `告警：A2`

#### Scenario: Template Name Two-Layer Rendering
- **GIVEN** `prompt_template_name` = `"workflow/custom"`
- **AND** 模板库返回的 renderedContent 含 `{{ agentId }}` 和 ``
- **WHEN** 生成 prompt
- **THEN** `{{ agentId }}` MUST 由 assemblePrompt 替换
- **AND** `` MUST 由模板引擎替换

#### Scenario: Fallback To Input Question
- **GIVEN** `prompt_template` 和 `prompt_template_name` 均未配置
- **AND** `context.variables.query` = `"查询告警详情"`
- **WHEN** 生成 prompt
- **THEN** userPrompt MUST 为 `"查询告警详情"`
- **AND** MUST 无 systemPrompt