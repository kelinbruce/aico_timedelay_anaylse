## 背景与问题（Why）

当前 workflow 能力组缺少统一的最小 contract，导致后续 package、dispatch、engine change 容易各自定义 `RecipeDefinition`、graph 结构和 execution result，形成平行语义。

本 change 只解决一个问题：冻结 workflow 执行范式的最小 public contract，让后续 change 在同一套类型上推进。

## 变更范围（What Changes）

- **修正** runtime capability vocabulary：静态 Recipe DSL 加载为可执行能力后统一发布为 `WORKFLOW`，`RECIPE` 不再是 `CapabilityKind`

- **新增** `agent-common` 中的 `WorkflowNodeType`
- **新增** `agent-contracts/core` 中的最小 workflow DSL：
  - `RecipeDefinition`
  - `FlowGraph`
  - `WorkflowNodeDef`
  - `WorkflowBranchDef`
- **新增** `agent-contracts/core` 中的最小执行 port 和 DTO：
  - `WorkflowExecutionService`
  - `WorkflowExecutionRequest`
  - `WorkflowExecutionResult`
  - `WorkflowNodeResult`
  - `WorkflowExecutionEvent`
- **新增** `AgentAssembly.recipeIds?: string[]`

## 不在范围内（Explicit Non-Goals）

- 不定义 `WorkflowExecutionSnapshot`
- 不定义 distributed branch scheduling / owner claim / branchId / nodeAttemptId
- 不定义 recipe durable store、event table 或 workflow persistence gateway
- 不定义 rollback / degrade / resume / recovery 的持久化契约
- 不定义节点私有 schema；`inputs`、`outputs`、`outputParser` 只保留 opaque shape

## Capability 影响（Capabilities）

### 新增 Capability

- `agent-contracts/core` workflow minimal contracts
- `agent-common` `WorkflowNodeType`

### 修改的 Capability

- `AgentAssembly` 新增 `recipeIds?: string[]`

## 影响范围（Impact）

- `agent-common`
- `agent-contracts/core`
- `agent-contracts/agent-assembly`

## 归档前更新基线（Baseline Promotion Plan）

- `docs/roadmap/p3-workflow-execution.md`：同步 Recipe 静态资源与 `WORKFLOW` runtime capability 的统一语义

行为契约：
- `openspec/specs/ts-core-contracts/spec.md`

设计视图：
- `openspec/designs/architecture/core-contracts.md`
- `openspec/designs/modules/agent-contracts.md`
- `openspec/designs/modules/agent-common.md`

验证入口：
- contract tests：schema、port 签名、字段约束
