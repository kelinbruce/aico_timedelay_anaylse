## 背景与问题

Workflow LLM 节点已落地基础执行能力（模型调用、prompt template、预算检查、安全输出），但存在以下不足：

1. **Prompt 模板无控制流**：当前 `interpolateString` 只支持 `` 简单变量替换，无法在 prompt 中循环展开数组或按条件拼接内容。电信场景中，告警列表、KPI 集合、设备清单等数组变量需要逐条展开到 prompt 中。
2. **只支持非流式调用**：LLM 节点统一走 `ModelInvocationService.complete()`，用户在最后一个节点需要等待整个生成完成才能看到输出。
3. **输出绑定语义不清晰**：`llm_result` 和 `llm_completion` 的语义边界模糊。`llm_result` 应为模型原始输出（含 content、reasoning、toolCalls、finishReason、usage），`llm_completion` 应为提取的 content（不含 reasoning）。当前 `llm_completion` 根据 `result_with_think` 包含 reasoning，语义不正确。
4. **非结构化输出未尝试 JSON 解析**：没有 `outputSchema` 时，`llm_completion` 直接存原始文本字符串。
5. **Prompt 生成流程不完整**：`prompt_template` 和 `prompt_template_name` 的变量替换时机不一致，`resolveNodeValue` 会提前消耗模板中的 `` 占位符。

## 变更范围

- **新增** Workflow 模板引擎模块，支持 `{% for %}` / `{% if %}` 控制流语法和 `` / `{{ var }}` 双语法变量引用
- **增强** LLM 节点流式/非流式双模式，通过 `inputs.is_stream` 字符串控制
- **增强** `llm_result` 为完整模型原始输出对象（含 content、reasoning、toolCalls、finishReason、usage），`llm_completion` 默认只包含 content（自动 JSON 解析）；`result_with_think = "true"` 时 `llm_completion` 包含 `{ content, reasoning }`
- **优化** Prompt 生成流程，统一三路优先级，模板引擎作用于原始 inputs 值

## Capability 影响

### 新增 Capability

- `workflow-template-engine`：独立的模板渲染模块，暴露 `renderTemplate(template, scope)` 函数

### 修改的 Capability

- `workflow-llm-node-handlers`：增强 LLM 节点 handler，支持流式调用、think 输出、新 prompt 生成流程

## 影响范围

- `agent-workflow`：新增模板引擎模块，重构 LLM 节点 handler
- `agent-contracts`：无 contract 变更
- `agent-core`：无变更（流式输出复用 `WorkflowRuntimeEventProjector` 已有的 `level` fast-path）
- 不影响非 workflow 场景

## 职责边界对齐

- 本 change 与 `add-ts-workflow-llm-nodes` 的关系：本 change 是增强，不修改已有 spec 的 MUST 约束
- 模板引擎是独立模块，`interpolateString` 保留不变
- 流式输出通过 `emitOutputDelta` 带 `level` 字段，复用 projector fast-path 走 `TOOL_STRUCTURED_DELTA`，不新增投影逻辑
- 主 recipe 判定复用 `executionMetadata.subRecipeDepth`，END 节点判定从 recipe flowGraph 推断，不新增 context 字段
- `prompt_template` 和 `prompt_template_name` 从原始 inputs 读取，绕开 `resolveNodeValue` 的提前替换

## 归档前基线更新

- `openspec/designs/modules/agent-workflow.md`：补充模板引擎模块和 LLM 流式调用设计

## 验证入口

- UT：模板引擎 for/if 嵌套渲染、变量解析、安全限制
- Integration test：LLM 节点流式调用 + `llm_completion` 包含 reasoning
- Integration test：LLM 节点非流式调用 + 自动 JSON 解析
- Integration test：主 recipe 最后节点默认流式
- Integration test：子 recipe 节点不触发默认流式
- Integration test：Prompt 三路优先级 + 模板引擎渲染 + 原始值读取
- Architecture test：模板引擎不依赖 agent-contracts 以外的包