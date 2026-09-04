## 背景和现状（Context）

`executeKnowledgeSearchNode` 通过现有 `retrieveKnowledge` boundary 取得 `WorkflowKnowledgeRetrievalResult.recommends`，再由 `knowledgeSearchBindings` 构造 binding，最后由现有 `projectNodeOutputs` 按 `node.outputs` 投影自定义 output key。当前 `projectNodeOutputs` 在 `outputs` 缺失或为空时会返回全部 binding；当前 `knowledgeSearchBindings` 则返回标题列表、`documents`、`sourceDocuments` 和 `knowledge_diagnostic`。这两个存量行为共同造成 knowledge-search 隐式暴露多套结果。

RAG adapter 已原样提供有序 `recommends`。问题完全位于 `agent-workflow` knowledge family 的节点声明校验和输出投影，不需要修改 gateway、adapter、`agent-contracts/core` 的 opaque `outputs` contract 或 composition。

## 目标和非目标（Goals / Non-Goals）

**目标：**
- 把 knowledge-search 的可映射结果收敛为 `knowledge_search_result` 与 `recall_result` 两个 canonical binding。
- 要求 knowledge-search 显式声明非空 `outputs`，并继续复用现有 `projectNodeOutputs` 支持自定义 output key。
- 对缺失/错误类型和空字符串正文定义互斥、可测试的处理规则。
- 以 knowledge node owner 内的最小增量完成变更。

**非目标：**
- 不改变 `knowledge-qa`、`api-choice`、`recipe-choice` 或其他节点输出。
- 不修改通用 workflow DSL、`WorkflowNodeDef`、RAG gateway/adapter 或检索参数。
- 不增加兼容 alias、默认全量输出、配置开关或第二套 projection abstraction。
- 不更新 usage 文档、历史残留文档或归档任何 active change。

## 设计决策（Decisions）

唯一实施路径保留现有调用链：`executeKnowledgeSearchNode -> knowledgeSearchBindings -> projectNodeOutputs`。

1. `executeKnowledgeSearchNode` 在发起检索前校验 `node.outputs` 是非空对象；否则通过现有 `WORKFLOW_NODE_INPUT_INVALID` 失败。每个 output value 必须是对 `${knowledge_search_result}` 或 `${recall_result}` 的精确映射；output key 不受 canonical 名称限制。节点可声明其中一个映射，也可同时声明两个，不提供隐式默认输出。
2. 现有 retrieval boundary 返回空 `recommends` 时，继续抛出 `WORKFLOW_KNOWLEDGE_SEARCH_EMPTY`。
3. `knowledgeSearchBindings` 按顺序检查每个召回项：`knowledge` 缺失或不是字符串时，抛出 `WORKFLOW_NODE_INPUT_INVALID`，不生成或提交任何节点输出。
4. 对字符串 `knowledge`，长度为零的字符串不进入正文列表；非空字符串原值进入 `knowledge_search_result`，不 trim、不改写，也不使用 `title`、`id` 或其他字段替代。
5. `recall_result` 直接绑定原始有序 `recommends`。即使所有 `knowledge` 都是空字符串，它仍保持不变，而 `knowledge_search_result` 为 `[]`。
6. `knowledgeSearchBindings` 只返回这两个 canonical binding。现有 `projectNodeOutputs` 负责把被声明的 binding 投影到自定义 key；未声明的 binding 不进入节点输出。

该路径从真实不变量推导：检索结果只有一份原始事实，下游只需要正文视图或原始召回视图。复用既有投影函数即可支持自定义 key，无需新增 DTO、port、通用 schema 或并行映射层，符合第一性原理与 KISS。校验和 binding 构造仍由 knowledge family owner 负责，`agent-contracts/core` 继续只承载 opaque `outputs`，不改变 frozen core contract。

## 失败和路径语义

- `outputs` 缺失、为空、包含非 canonical 映射，或召回项 `knowledge` 缺失/非字符串：节点以 `WORKFLOW_NODE_INPUT_INVALID` 失败，当前正常 workflow 路径中断，不提交部分 output variables；配置的通用 `onError` 路径仍按既有 engine 语义处理。
- 空 `recommends`：保持既有 `WORKFLOW_KNOWLEDGE_SEARCH_EMPTY`。
- 字符串类型的空正文：不是失败，不进入正文列表，流程继续。
- 检索 gateway 失败、取消、超时和 retry 行为：保持不变。

## 质量属性设计（Quality Attributes）

| 质量属性 | 设计结论 | 验证入口 |
|---|---|---|
| 安全 | 不新增身份、外部输入、日志或 provider payload；只投影当前检索结果。 | 节点负向测试、语义 review |
| 容量 | 单次 O(n) 校验和正文投影；`recall_result` 复用受 `rankTopN` 限制的原始列表。 | RAG E2E 测试 |
| 可靠性 | 类型错误在输出提交前失败；空正文与结构错误严格区分。 | 节点 failure tests |
| 可维护性 | 复用 `projectNodeOutputs`，只收敛现有 binding，不增加抽象。 | diff review、architecture lint |
| 可测试性 | 自定义 key、单 binding、双 binding、空正文和非法正文均可由注入 retrieval 确定性验证。 | knowledge node tests |

## 验证映射（Verification Map）

| 约束 | Task | 验证入口 |
|---|---|---|
| 非空 outputs；自定义 key 可映射一个或两个 canonical binding | 1.1、2.1 | `workflow-knowledge-nodes.test.ts` |
| 只存在两个 canonical binding | 1.2、2.2 | node tests、RAG E2E、全仓搜索 |
| 正文按顺序投影且空字符串被忽略 | 1.2、2.3 | node tests、RAG E2E |
| 全部正文为空时正文为空列表、召回保持原值 | 1.2、2.4 | node test |
| 缺失或非字符串正文中断正常路径并明确失败 | 1.2、2.5 | node negative tests |
| knowledge-qa 和其他节点不变 | 2.6、3.1 | 相关回归测试、contract tests |
| OpenSpec 和文本门禁 | 3.2 | `openspec validate --all --strict`、`git diff --check` |

## 文档承载和并行边界

- 本 change 完整承载 knowledge-search 输出 contract。
- `add-ts-workflow-rag-index-params` 只承载检索参数、index type 和空召回行为，不再重述 knowledge-search 输出 shape；该 change 保持 active。
- usage 与历史残留文档明确 deferred，不进入 tasks 或 acceptance。
- `agent-contracts`、架构/core contracts、gateway 和其他 node family 无写入任务。

## 待确认问题（Open Questions）

无。
