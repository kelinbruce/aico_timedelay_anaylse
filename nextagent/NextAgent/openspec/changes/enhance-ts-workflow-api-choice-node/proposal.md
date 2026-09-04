## 背景与问题（Why）

`api-choice` 节点已在 `add-ts-workflow-knowledge-nodes` 中落地基础能力（bounded candidate 选择 + RAG 召回后选择），但与产品 Recipe YAML 规范定义的完整能力相比存在以下缺口：

1. **路径入口缺少显式控制**：当前路径选择靠 `candidateApis` 是否为空隐式判断，缺 `open_api_recall` 开关。产品规范要求不开启 RAG 时走纯大模型 N 选 1，开启时走 RAG 召回 + 大模型 TopN 选 1。
2. **Prompt 配置体系缺失**：不开启 RAG 时必须提供 `top1_choice_prompt` 作为大模型推理 prompt，当前未读取；`api_choice_prompt_template_name` 按名称查询 prompt 模板能力未实现。
3. **知识召回路径缺失**：`open_api_knowledge_recall` 开关和对应的双路召回（API 索引 + Knowledge 索引）未实现，无法在 API 选择同时获取知识凭证。
4. **追问机制缺失**：`open_reflection` 追问开关和对应的 `NEED_MORE_KEY` 追问、`NEED_MORE_KEY` 追问机制未实现（RETRY_RAG 重试为 deferred）。
5. **节点级模型路由未透传**：`model`/`modelGroup`/`model_params` 等节点级参数未读取和透传到模型调用。
6. **输出变量不完整**：缺少 `knowledge` 输出（知识召回内容）；RAG 路径缺少 `knowledge_diagnostic`（与 `knowledge-search` / `recipe-choice` 同形同策）。
7. **中间步骤事件缺失**：规范要求中间数据子步骤产出，当前未产出。

## 变更范围（What Changes）

- **增强** `api-choice` 节点 handler，覆盖完整的产品规范能力
- **新增** `open_api_recall`/`open_api_knowledge_recall` 入口控制
- **新增** 不开启 RAG 时的 `top1_choice_prompt`/`api_choice_prompt_template_name` prompt 配置体系（复用 `prepareLlmPrompt` + 模板引擎）
- **新增** 知识召回路径（API 索引 + Knowledge 索引双路召回）
- **新增** `knowledge` 输出变量
- **新增** `knowledge_diagnostic` 输出（RAG 路径，显式声明时投递，与 `knowledge-search` / `recipe-choice` 同形同策）
- **新增** `open_reflection` 反思重试机制
- **新增** 节点级模型路由参数透传（复用 `resolveModelForParamExtract`）
- **新增** 中间步骤事件（通过 `emitOutputDelta` + `metadata.step`）
- **新增** think 标签移除能力（`remove_think_tags` 控制，默认不移除）

## Capability 影响

### 修改的 Capability

- `workflow-knowledge-node-handlers`：增强 `api-choice` handler

### 复用的外部依赖

- Prompt 模板引擎：复用 `enhance-ts-workflow-llm-nodes` 的 `prepareLlmPrompt` + `n()` / `renderTemplate`
- 模型路由：复用已有的 `resolveModelForParamExtract` 机制

## 影响范围

- `agent-workflow`：增强 `executeApiChoiceNode` 及相关函数
- `agent-contracts`：无 contract 变更（`api-choice` 的输入输出通过 opaque `inputs`/`outputs` 通透，不冻结强类型）

## 职责边界对齐

- 本 change 仅增强 `api-choice` 节点，不修改 `knowledge-search`/`knowledge-qa`/`recipe-choice` 的已有行为
- Prompt 模板服务复用 `prepareLlmPrompt`，不在 `agent-workflow` 内部实现模板存储
- 模型路由复用已有的 `resolveModelForParamExtract` 机制，节点级参数通过 `model_params` 透传覆盖
- 实际 API 调用仍由 `restful` 节点 owner；本 change 只产出选择结果
- 知识召回内容通过 `knowledge` 输出变量传递给下游，不直接落盘或修改持久化

## 归档前基线更新

- `openspec/specs/workflow-knowledge-nodes/spec.md`：补充 `api-choice` 增强的 spec 条目
- `openspec/designs/architecture/workflow-execution-and-routing.md`：补充 `api-choice` 完整路径设计

## 验证入口

- Integration test：不开启 RAG 时 `top1_choice_prompt` 正确传入大模型
- Integration test：`open_api_recall=true` 时走 RAG 召回 + TopN 选 1
- Integration test：`open_api_knowledge_recall=true` 时双路召回，`knowledge` 输出非空
- Integration test：`open_reflection=true` 时 `NEED_MORE_KEY` 追问异常正确抛出
- Integration test：节点级 `model_params` 透传到模型调用
- Integration test：中间步骤事件 `step: "rag_recall"`/`"rating"`/`"llm_reasoning"` 正确产出
- Integration test：`open_api_recall=false` + `candidateApis` 为空报错
- Integration test：默认不移除 think 标签，`remove_think_tags: "true"` 时移除