## 背景与问题（Why）

`batchConfig` 由 `refine-ts-workflow-recipe-v2-contracts` change 引入，当前仅 restful(api-invoke) 节点支持。电信网络场景中，模型反思后拆分多个子问题，每个子问题需要独立执行 knowledge-search 或 llm-router，子问题个数在编写 recipe 时未知（运行时由模型输出决定）。

当前 restful 节点的 batch 实现已提供完整的并发编排能力：分批、并发度限流、失败策略、结果汇聚（append/map）。knowledge-search 和 llm-router 的 handler 入口没有 batchConfig 分支，无法承接这一场景。

三个节点的批量编排逻辑完全同构——差异只在 per-element 调用边界（capabilityInvocation / retrieveKnowledge / modelInvocation），编排框架（chunkArray、parallel/serial、failStrategy、resultMerge）完全一致。按"同形同策"原则，应提取共享编排框架，让三个 handler 各自接入。

## 变更范围（What Changes）

- **扩展** `batchConfig` 适用节点范围：从仅 `RESTFUL` 扩展到 `RESTFUL` + `KNOWLEDGE_SEARCH` + `LLM_ROUTER`
- **提取** 共享 batch 编排框架：`readBatchConfig`、`executeBatch`、`chunkArray`、`createBatchFailedItem`、`mergeBatchResultsAsMap` 从 capability-nodes.ts 提取到共享模块
- **接入** `executeLlmNode` batch 分支：batch 模式强制非流式（`modelInvocation.complete`），modelConfig 只解析一次
- **接入** `executeKnowledgeSearchNode` batch 分支：batch 模式下空检索结果转为 failed item（不 throw）
- **修改** `LoopBatchMutex` requirement：batchConfig 不再仅 restful，适用范围更新
- **不改** `batchConfig` schema 定义（`WorkflowBatchConfigSchema` 已在 `WorkflowNodeDef` 上，所有节点类型可声明）
- **修改** loader 的 `normalizeNodeDefinition`：当前 `batchConfig` 归一化被 `normalizedType === "RESTFUL"` 门控（第 397 行），KNOWLEDGE_SEARCH 和 LLM_ROUTER 的 `batchConfig` 会被静默丢弃。MUST 移除节点类型门控，让所有节点类型的 `batchConfig` 都经过 `normalizeBatchConfig` 归一化。互斥校验逻辑不变。
- **不改** `normalizeBatchConfig` 函数本身（归一化逻辑与节点类型无关，只是调用处被门控了）

## 不在范围内（Explicit Non-Goals）

- 不实现多节点链路并发（knowledge-search -> llm-router 整体并发），该场景由 loopConfig parallel mode 承接
- 不改 `batchConfig` schema 字段（`batchElementVariable`/`batchSize`/`batchMode`/`batchFailStrategy`/`batchParallelism`/`batchResultMerge` 保持不变）
- **例外：修正 `batchInputDataItem` schema 类型**：当前 `Type.Array(Type.Unknown())` 不接受模板字符串占位符（`${...}`），导致 YAML 中写 `batchInputDataItem: ` 经 Ajv 校验失败、recipe 被静默跳过。修正为 `Type.Union([WorkflowOpaqueArraySchema, Type.String({ minLength: 1, maxLength: 1024 })])`，与 `loopInputDataItem` 同形同策（`loopInputDataItem` 已是 `Type.String()`，运行时经 `resolveNodeValue` 解析为数组）。字段语义不变，只是修正类型让模板字符串占位符在加载阶段通过校验。
- 不改 loopConfig 语义
- 不改 engine 执行路径（batch 在 handler 内部完成，不经过 engine loop/fork-join）

## Capability 影响（Capabilities）

### 修改的 Capability

- workflow-contracts：`RestfulBatchConfig` requirement 扩展为适用 `RESTFUL` + `KNOWLEDGE_SEARCH` + `LLM_ROUTER`（仅限 LLM_ROUTER，其他 LLM 族节点不支持）；`LoopBatchMutex` 适用范围更新
- workflow-node-handlers：knowledge-search 和 llm-router handler 接入 batchConfig

## 影响范围（Impact）

- `agent-workflow/src/nodes/`：提取共享 batch 模块；capability-nodes.ts、llm-nodes.ts、knowledge-nodes.ts 接入
- `agent-contracts/core`：修正 `WorkflowBatchConfigSchema.batchInputDataItem` schema 类型为 `Union(Array, String)`，接受模板字符串占位符
- `agent-workflow/src/workflow-recipe-loader.ts`：`normalizeNodeDefinition` 移除 `normalizedType === "RESTFUL"` 门控，让 `batchConfig` 归一化适用于所有节点类型
- 跨 package 边界不变

## 职责边界对齐（Boundary Alignment）

- `refine-ts-workflow-recipe-v2-contracts`：batchConfig 契约原始 owner，本 change 扩展其适用范围；`batchInputDataItem` schema 类型修正在本 change 承载（MODIFIED `RestfulBatchConfig` requirement 归档时覆盖原始 ADDED 版本）
- `add-ts-workflow-capability-nodes`：restful batch 实现原始 owner，本 change 提取共享编排框架，restful handler 行为不变
- `add-ts-workflow-knowledge-nodes`：knowledge-search handler owner，本 change 在其入口加 batch 分支
- `add-ts-workflow-llm-nodes`：llm-router handler owner，本 change 在其入口加 batch 分支
- `add-ts-workflow-parallel-gateway`：engine 级 fork/join 并发，与本 change 的 handler 内 batch 并发正交

## 归档前更新基线（Baseline Promotion Plan）

- `openspec/specs/workflow-contracts/spec.md`：`RestfulBatchConfig` requirement 提升为基线时，重命名为 `NodeBatchConfig`，反映适用范围从仅 RESTFUL 扩展到 RESTFUL + KNOWLEDGE_SEARCH + LLM_ROUTER。OpenSpec MODIFIED requirement 名称 MUST 匹配源 requirement，因此 delta 阶段不能改名，归档提升基线时改名。
- `openspec/designs/modules/agent-workflow.md`：补充 batch 编排框架的共享提取和三节点接入说明。

## 验证入口（Validation）

- `openspec validate --all --strict`
- `npm run build`
- `npm test`（restful batch 回归、llm-router batch 新增、knowledge-search batch 新增）
- `npm run lint:architecture`（共享 batch 模块不破坏架构边界）
