# add-ts-workflow-engine-contracts

规划入口：[roadmap-v2](../nextagent-ts-change-roadmap-v2.md)
所属分组：P3 — Workflow 执行范式

状态：candidate
类型：核心契约 change
主要 owner：`agent-contracts`、`agent-common`
依赖：`establish-ts-core-contracts`

目标：
- 在 `agent-contracts/core` 冻结 workflow 最小 public contract。
- 在 `agent-common` 提供 workflow 共享 vocabulary。

规格输入：

- `WorkflowNodeType` 归 `agent-common`。
- `RecipeDefinition` 只冻结最小字段：`recipeName`、`version`、`displayName`、`description?`、`flowGraph`、`timeoutMs?`、`priority?`。
- `FlowGraph` 只允许一套结构：`nodes: Record<string, WorkflowNodeDef>`。
- `WorkflowNodeDef` 只冻结节点共用字段与 `next` 分支，不冻结节点私有 schema。
- `WorkflowExecutionService` 只定义 `execute(request, signal)`。
- `WorkflowExecutionResult`、`WorkflowNodeResult`、`WorkflowExecutionEvent` 只表达单次执行最小输入输出与生命周期观测。
- `AgentAssembly` 增加 `recipeIds?: string[]`，只表达静态 recipe 绑定。

契约输入：

- `WorkflowNodeType`
- `RecipeDefinition`
- `FlowGraph`
- `WorkflowNodeDef`
- `WorkflowBranchDef`
- `WorkflowExecutionService`
- `WorkflowExecutionRequest`
- `WorkflowExecutionResult`
- `WorkflowNodeResult`
- `WorkflowExecutionEvent`
- `AgentAssembly.recipeIds?: string[]`

实现约束：

- 本 change 不得定义第二套 graph shape，例如 `edges` 或平行 DSL。
- 本 change 不得冻结 snapshot、resume、recover、distributed owner、branchId、nodeAttemptId。
- 本 change 不得冻结 recipe durable store、workflow event durable store 或 workflow history query contract。
- 节点私有输入输出、loop、rollback、degrade 不得在本 change 固化；`exception` 字段结构（`Record<string, WorkflowBranchDef>`，与 `next` 同级）可在本 change 声明，但其求值时机与失败优先级链执行语义归 `execution-engine` owner。

非目标：

- `WorkflowExecutionSnapshot`：后置到 `add-ts-workflow-persistence-recovery`
- distributed execution / multi-owner claim：后置到 `add-ts-workflow-distributed-execution`
- loop 控制流：后置到 `add-ts-workflow-loop-control`
- recipe durable registry：后置到 `add-ts-workflow-recipe-registry-persistence`
- workflow event durable history：后置到 `add-ts-workflow-event-history`

验收要点：

- contract test：最小 schema 可校验
- contract test：`execute()` 签名稳定
- contract test：`WorkflowExecutionEvent` 不含敏感字段
- contract test：`AgentAssembly.recipeIds` 为可选字段

并行边界：

- 只冻结 contract，不预占 execution、persistence、recovery 或 routing owner。

后续维护：

- 如果后续需要扩大 workflow contract，必须先明确属于哪一个后续 change 的唯一 owner。
