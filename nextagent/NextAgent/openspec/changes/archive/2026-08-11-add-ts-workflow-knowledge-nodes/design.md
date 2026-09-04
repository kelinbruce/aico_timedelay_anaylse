## 背景和现状（Context）

knowledge 节点族位于 workflow 中“检索 -> 选择 -> 回答 -> 下游执行”的关键链路，既影响预算，也影响后续节点的安全边界。如果没有单独收口，很容易把开放式 discovery、过大文档内联或旧 `recipeId` 命名带进实现。

## 目标和非目标（Goals / Non-Goals）

**目标：**
- 统一 knowledge 节点输入和输出口径
- 统一 source ref、安全摘要和结果截断约束
- 统一 `api-choice` / `recipe-choice` 的 bounded candidate 语义

**非目标：**
- 不实现知识写入、索引构建或多知识库联合检索
- 不提供开放式 API / recipe discovery
- 不把原始大文档直接落入 snapshot / output
- 不 owner主请求 routing、sub-recipe 执行、通用 LLM transformation 或 capability side effect

## 设计决策（Decisions）

1. `knowledge-search` 通过知识 gateway 调用，不直接耦合底层索引实现
2. `knowledge-qa` 先检索、后问答，且中间证据受 budget / truncation 约束
3. `api-choice` / `recipe-choice` 只在 bounded candidate set 中选择
4. `recipe-choice` 的 DSL 输出字段保持 `recipe_name`；如内部 contract 有映射，不得反向修改 DSL
5. `api-choice` 的 DSL 输出字段保持 `api_name`；TypeScript 内部可使用 `apiName`，但必须在节点 handler 的 DSL 边界映射为 `api_name`
6. source refs 只保留可消费引用和安全摘要，不保留原始全文
7. knowledge-search / knowledge-qa / api-choice / recipe-choice 的 node-specific schema 由本 change 定义；`agent-contracts/core` 不为这些字段冻结强类型

### rag_index 对象数组结构（补充）

`rag_index` 在 DSL 中是对象数组，每个对象包含：
- `domain`（可选）
- `scene`（可选）
- `index_name`（必填）
- `index_type`（可选）
- `priority`（可选）

workflow 层解析时保留完整对象结构（`WorkflowKnowledgeIndex`），传递给下游 knowledge gateway 调用时仅提取 `index_name` 作为 `string[]`，因为 gateway contract `RagRetrievalRequest.indexes` 仍是 `readonly string[]`。这不改变 gateway contract，只在 workflow 节点层扩展输入表达力。

### api-choice 两阶段召回（补充）

`api-choice` 支持两种选择路径，与 `recipe-choice` 的双路径保持对称：
- 路径一（直接 LLM N 选 1）：`candidateApis` 非空时，直接由 LLM 在 bounded candidate 中选 1
- 路径二（RAG 召回 N 选 5 -> LLM 5 选 1）：`candidateApis` 为空且存在 `rag_index` + `query` 时，先执行 RAG 召回，取 top5 文档作为候选（文档 `title` 作为 `apiName`，`excerpt` 作为 `description`），再由 LLM 5 选 1

两条路径都输出固定字段 `api_name`；路径二仅在 Recipe 显式声明 `outputs.recall_result: ${recall_result}` 时额外投影固定字段 `recall_result`，不得因未声明该诊断输出而拒绝只消费 `api_name` 的 Recipe。内部候选对象可使用 `apiName`，但 `apiName`、`mappedParams`、`api_choice_result` 和 `knowledge_diagnostic` 不得成为 Recipe 1.0 DSL 输出；节点 handler 不保留无下游消费者的冗余结果。RAG 召回为空时抛出 `WORKFLOW_API_CHOICE_NOT_FOUND`。

## 跨 Change 边界矩阵（Cross-Change Boundary Matrix）

- `package-composition`：负责 recipe 和依赖的 startup wiring；knowledge 节点只消费已装配 knowledge gateway / model service
- `workflow-routing`：负责主请求进入 workflow；`recipe-choice` 不改变 routing owner，只输出供后续节点消费的 `recipe_name`
- `workflow-execution-engine`：负责调度、retry、timeout、cancel；knowledge 节点不自带独立异步编排器
- `workflow-gateway-nodes`：负责 graph control semantics；knowledge 节点不承担分支或终止逻辑
- `workflow-llm-nodes`：负责通用模型调用、prompt assembly、结构化生成；knowledge change 仅 owner“检索后问答”和 bounded candidate choice，不复制通用 LLM 节点族
- `workflow-interaction-nodes`：负责 `sub-recipe` 执行与用户交互；knowledge change 的 `recipe-choice` 只产出选择结果
- `workflow-capability-nodes`：负责 `restful` side effect；knowledge change 的 `api-choice` 只产出选择结果

## 触发机制（Trigger）

- 节点 ready 时触发
- `knowledge-search` 是同步启动 + 异步等待检索返回
- `knowledge-qa` 是“检索阶段 + 模型问答阶段”的组合节点

## 输入与前置条件（Inputs / Preconditions）

- 标准 `rag_index`、`query`、过滤条件、topN 配置
- bounded candidate APIs / recipes
- 可用的知识 gateway、模型调用服务、prompt template

## 输出与副作用（Outputs / Side Effects）

- safe 文档列表、answer、source refs、候选选择结果
- recall / ranking diagnostic
- 不全量输出原始大文档

## 核心判断逻辑（Core Decision Logic）

1. 读取节点输入和检索配置
2. 执行检索或候选召回
3. 对结果排序、裁剪并生成 safe source refs
4. 若是 `knowledge-qa` / choice 节点，再调用模型完成回答或选择
5. 输出 safe 结果给下游

## 状态 / 产物契约（State / Artifact Contract）

- `documents` / `sourceDocuments`：语义为“供当前 execution 消费的安全检索摘要”，生命周期与 execution 一致
- `source refs`：应能追溯到知识条目或候选项，但不得泄露不必要全文
- `api_name`：`api-choice` 的 Recipe 1.0 DSL 固定输出，消费方为下游 `restful`
- `recipe_name`：`recipe-choice` 的 DSL 输出，消费方为 `sub-recipe`；解析通过 app-composed recipe definition source，候选可见性由 WORKFLOW capability catalog 约束

## 流程接入（Flow Integration）

- 上游：`question-rewriting`、`param-extract`、gateway 节点
- 下游：
  - `knowledge-search` -> `knowledge-qa` / `llm-router`
  - `api-choice` -> `restful`
  - `recipe-choice` -> `sub-recipe`

## 失败与降级（Failure / Degradation）

- 检索失败 -> 节点失败或走 `onError`
- 结果过大 -> 裁剪 / 摘要，不得静默全量内联
- choice 返回候选集外的结果 -> validation 失败
- recipe 名称不存在 -> 下游 `sub-recipe` 明确失败

## 验收样例（Acceptance Examples）

- 正常路径：`knowledge-search` 返回 topN 文档和 safe score
- 边界路径：`knowledge-qa` 证据过大时只传摘要和 refs
- 失败路径：`recipe-choice` 返回候选集外的名称，被 validation 拒绝
- 兼容路径：`recipe-choice` 继续保持 DSL `recipe_name`，不得回摆为旧 `recipeId`

## 长期基线刷新计划

本节将旧模板的“归档前更新基线”归一为可审计的归档门禁；以下均为**归档前待执行**，不表示 stable baseline 已刷新。

- **Function：**以 `FN-9.6-执行知识节点` 为唯一用户可见行为 owner；若本 change 增加的行为不能被该 Function 的既有边界完整表达，先在同一能力域新增一个单一职责 Function，再更新 `openspec/designs/functions/index.md`，不得把实现细节直接写入 Function。
- **Stable spec：**将 delta Requirement 合并至 `openspec/specs/workflow-knowledge-nodes/spec.md`，逐条核对 Requirement 标题、MUST/SHALL 语义、场景、迁移和 metadata；不得以 `--skip-specs` 绕过同名 Requirement 重叠。
- **长期设计：**先执行本 design/proposal 已列出的“归档前更新基线”设计 owner；再在 `openspec/designs/spec-to-design-map.md` 为上述 stable spec 写入该 Function、实际承载的 architecture/module/ADR 与验证入口。若现有 map 无该 spec 行，先创建该行，而非把 change-local design 当作长期设计。
- **归档判定：**Function、stable spec、长期设计和 map 四端均完成 diff 审阅且 `openspec validate --all --strict` 通过后，才允许归档；任一端无法唯一归属时保留 active 并标记阻塞。

## 归档阻塞记录（2026-07-31）

- **状态：**保持 active，禁止使用 `--skip-specs`。
- **原因：**`Knowledge Search`、`API Choice` 与 stable 正文不同。
- **解除条件：**逐 Requirement 建立 delta、stable target、Function 与长期设计的双端映射；确认正文、元数据、Scenario 和任何 REMOVED→ADDED/MODIFIED 迁移均完整同步后，再重新执行 archive。
