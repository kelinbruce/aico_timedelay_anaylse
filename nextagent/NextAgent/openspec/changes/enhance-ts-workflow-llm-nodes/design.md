## 背景和现状

LLM 节点已落地基础能力，但 prompt 模板只有简单变量替换、只支持非流式、输出不含推理过程、非结构化输出不尝试 JSON 解析、prompt 生成流程 fallback 不直观。

## 目标和非目标

**目标：**
- 支持模板引擎 for/if 嵌套控制流
- 支持流式/非流式双模式
- llm_completion 可选包含 reasoning
- 自动 JSON 解析 content
- 统一 Prompt 三路优先级

**非目标：**
- 不修改 agent-contracts 的 core contract
- 不改变现有 interpolateString 的行为（保持向后兼容）
- 不影响非 workflow 场景
- 不引入 provider 专属参数
- 不支持 if 条件中的比较运算符（第一版只做真值判断）
- 不支持 `{% else %}`
- userPrompt 不需要模板引擎渲染

## 设计决策

### D1: 模板引擎独立模块

- 位置：`agent-workflow/src/template-engine/`
- 暴露 `renderTemplate(template: string, scope: JsonObject): string`
- 语法：`{% for item in list %}` / `{% if condition %}` / `{% endif %}` / `{% endfor %}`
- 变量引用：`` 和 `{{ var.path }}` 双语法，在循环体内外均可使用
- for/if 任意嵌套
- 循环体内 `item` 作为循环变量注入局部作用域，可访问 `item.field`，也可访问外部变量
- 安全：只读 scope、循环最大迭代数 10、模板语法错误抛 `TEMPLATE_SYNTAX_ERROR`、未闭合标签抛 `TEMPLATE_UNCLOSED_BLOCK`、超限抛 `TEMPLATE_LOOP_LIMIT_EXCEEDED`

### D2: 真值判断语义

`{% if var.path %}` 的真值判断采用扩展语义，与 JavaScript 原生语义不同：
- falsy：空数组 `[]`、空对象 `{}`、空字符串 `""`、`0`、`null`、`undefined`
- truthy：其他值（非空数组、非空对象、非空字符串等）

原因：电信场景中 `{% if alarms %}` 在 `alarms = []` 时不应该渲染"有告警"。扩展语义更符合 DSL 直觉。

### D3: 模板引擎输入来源

模板引擎作用于 `context.node.inputs` 的**原始值**，而非经过 `resolveNodeValue` 处理后的 `resolvedInputs`。原因：`resolveNodeValue` 会递归替换所有 `` 占位符，导致模板中的循环变量引用被提前消耗。

- `prompt_template`：从 `context.node.inputs.prompt_template` 读取原始字符串，经模板引擎渲染
- `prompt_template_name`：从 `context.node.inputs.prompt_template_name` 读取原始名称字符串，用 agentId + agentVersion 查询模板库，返回的 renderedContent 再经模板引擎渲染
- 其他 inputs 字段（`is_stream`、`result_with_think` 等）仍走 `resolveNodeValue` 正常解析

### D4: 变量语法边界

`assemblePrompt` 使用 `{{name}}` 语法替换 agent 元信息变量，未知变量会抛 `TEMPLATE_VARIABLE_UNKNOWN`。模板引擎使用 `` 语法替换 workflow 变量。

在 `prompt_template_name` 路径中，模板库内容引用 workflow 变量 MUST 使用 `` 语法。`{{ var }}` 语法在 assemblePrompt 阶段已被消费或拒绝，不会传递到模板引擎。

### D5: 流式/非流式双模式

- `inputs.is_stream = "true"`（字符串比较）-> 调用 `ModelInvocationService.stream()`
- `inputs.is_stream = "false"`（字符串比较）-> 调用 `ModelInvocationService.complete()`
- 未配置 `is_stream` 时：
  - 主 recipe 中，当前节点的 next 包含指向当前 recipe END 节点的路径 -> 默认流式
  - 其他情况 -> 默认非流式
- 主 recipe 判定：`context.request.executionMetadata?.subRecipeDepth` 未定义或为 0 即主 recipe，复用现有字段，不新增
- END 节点判定：从 `context.recipe.flowGraph.nodes` 中找到 `type === "END"` 的节点 ID，检查当前节点的 next 是否包含该 ID，不新增字段
- 子 recipe 内的节点不算"最后节点"，不触发默认流式

### D6: 流式输出投影

流式输出通过 `emitOutputDelta` 发送，带上 `level` 字段：

- content: `emitOutputDelta({ channel: "CONTENT", content: delta, level: "ANSWER" })`
- reasoning: `emitOutputDelta({ channel: "THINKING", content: delta, level: "DETAIL" })`

`WorkflowRuntimeEventProjector` 已有 fast-path 逻辑：当 `visibleDelta.level` 存在时走 `TOOL_STRUCTURED_DELTA` 路径。只需多传 `level` 字段，不新增投影逻辑。

流式发送完毕后，完整输出存入 `llm_completion`，与非流式一致。

### D7: llm_result 和 llm_completion 输出绑定语义

llm_result 和 llm_completion 是 LLM_ROUTER/LLM 节点的两个系统内置输出绑定，语义明确分离：

**llm_result — 模型原始输出对象：**
```
{
  content: <parseWorkflowLlmPayload 结果>,    // 已 parse / schema 校验
  reasoning?: string,                          // 来自 modelResult.reasoning
  toolCalls?: ModelToolCall[],                 // 来自 modelResult.toolCalls
  finishReason?: ModelFinishReason,            // 来自 modelResult.finishReason
  usage?: ModelUsage                           // 来自 modelResult.usage
}
```
- 始终包含 content
- reasoning、toolCalls、finishReason、usage 有值时包含，无值时省略
- 不受 result_with_think 影响

**llm_completion — 提取的 content（受 result_with_think 控制）：**
```
// result_with_think = "true" 且 reasoning 存在时：
{ content: tryParseJsonContent(llm_result.content), reasoning: string }

// 默认或 result_with_think = "false" 时：
tryParseJsonContent(llm_result.content)
```
- `result_with_think = "true"` -> 包含 `{ content, reasoning }`（当 reasoning 存在时）
- 默认或 `"false"` -> 只有 content
- content 始终经 tryParseJsonContent 解析（JSON 对象或字符串）

**与原始设计的差异（从 enhance change D7 原始版本）：**
- 原始设计：默认包含 reasoning（result_with_think !== "false"），llm_completion shape 为 { content, reasoning }
- 新设计：默认不包含 reasoning（只有 result_with_think === "true" 才包含）
- 原因：llm_completion 是“提取的 content”，默认应该只有 content；需要 reasoning 时显式开启
- llm_result 从“content”扩展为“完整模型输出对象”（加 reasoning、toolCalls、finishReason、usage）
- 影响：现有引用 ${llm_result} 期望 content 的 recipe/测试需要迁移到 ${llm_completion}

### D8: Prompt 生成流程

优先级（从高到低）：
1. `prompt_template` 非空 -> 从原始 inputs 读取，经模板引擎渲染后作为 systemPrompt
2. `prompt_template_name` 非空 -> 从原始 inputs 读取名称，按 agentId + agentVersion 查模板库，返回的 renderedContent 再经模板引擎渲染后作为 systemPrompt
3. 均空 -> 使用 `context.variables` 中的 `query` / `question` 字段作为 userPrompt，无 systemPrompt

**systemPrompt 渲染约束：**
- 路径 1 和 2 的 systemPrompt 经过模板引擎渲染
- userPrompt 保持现有逻辑（`buildWorkflowLlmUserPrompt` 或 `inputVariables.query`），不经过模板引擎
- 原因：userPrompt 是用户问题文本或已解析 inputs 构造的字符串，不含模板语法

**prompt_template_name 静态名称约束：**
- `prompt_template_name` 是静态名称字符串，不含变量引用
- 需要动态模板选择时，通过 `prompt_template` + 模板引擎 `{% if %}` 实现

### D9: 变量作用域

模板引擎的 scope 与当前 `context.variables` 一致：
- workflow 的 inputVariables
- 所有前置节点的 outputs 合并值
- 循环节点注入的 loopElementVariable

## 状态 / 产物契约

- 模板引擎：纯函数，无副作用，不修改 scope
- 流式 LLM 节点：产出 `llm_completion`（含可选 reasoning），产出 lifecycle event
- `llm_completion` 的 shape 由 `result_with_think` 决定，下游节点通过 `outputs` 映射消费

## 失败与降级

- 模板语法错误 -> 抛 `TEMPLATE_SYNTAX_ERROR`，节点失败
- 未闭合标签 -> 抛 `TEMPLATE_UNCLOSED_BLOCK`，节点失败
- 循环超过 10 次 -> 抛 `TEMPLATE_LOOP_LIMIT_EXCEEDED`，节点失败
- 流式调用中模型超时/cancel -> 与非流式一致，响应 AbortSignal
- assemblePrompt 失败 -> 抛 `WORKFLOW_LLM_PROMPT_TEMPLATE_UNAVAILABLE`，节点失败
- JSON.parse 失败 -> 不报错，保留原始文本
- 模型返回无 content -> 节点失败，不静默传递空结果

## 与 Change 边界矩阵

- `add-ts-workflow-llm-nodes`：本 change 是增强，不修改已有 MUST 约束
- `add-ts-workflow-execution-engine`：本 change 复用 `executionMetadata.subRecipeDepth` 判定主 recipe，不新增引擎字段
- `add-ts-workflow-knowledge-nodes`：知识检索节点输出的数组变量可被模板引擎循环展开，不改变知识节点 owner
- `agent-context-engine`：`prompt_template_name` 路径仍走 assemblePrompt，本 change 只对返回内容追加模板引擎渲染
- `agent-core`：流式输出复用 `WorkflowRuntimeEventProjector` 已有的 `level` fast-path，不新增投影逻辑