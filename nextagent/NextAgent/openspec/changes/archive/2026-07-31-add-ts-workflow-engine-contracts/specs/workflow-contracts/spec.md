## ADDED Requirements

### Requirement: WorkflowNodeType Enum

TS 后端 MUST 在 `agent-common` 中定义 `WorkflowNodeType`，供 workflow contract 和后续 workflow changes 共同复用。

#### Scenario: Enum Value Accessibility
- **WHEN** workflow 相关模块 import `agent-common`
- **THEN** 这些模块 MUST 能访问统一的 `WorkflowNodeType`

### Requirement: RecipeDefinition

TS 后端 MUST 在 `agent-contracts/core` 中定义最小 `RecipeDefinition`。

`RecipeDefinition` MUST 包含：
- `recipeName: string`
- `version: string`
- `displayName: string`
- `description?: string`
- `flowGraph: FlowGraph`
- `timeoutMs?: number`
- `priority?: number`

`RecipeDefinition` MAY 包含：
- `inputSchema?`
- `outputSchema?`

#### Scenario: Recipe Shape Completeness
- **WHEN** 系统加载一个 workflow recipe
- **THEN** 解析结果 MUST 能映射到 `RecipeDefinition`

### Requirement: FlowGraph

TS 后端 MUST 在 `agent-contracts/core` 中定义最小 `FlowGraph`。

`FlowGraph` MUST 只包含：
- `nodes: Record<string, WorkflowNodeDef>`

`WorkflowNodeDef` MUST 包含：
- `type: WorkflowNodeType`
- `next: Record<string, WorkflowBranchDef>`

`WorkflowNodeDef` MAY 包含：
- `description?`
- `inputs?`
- `outputs?`
- `outputParser?`
- `timeoutMs?`
- `retryPolicy?`
- `onError?`

`WorkflowBranchDef` MAY 只包含：
- `condition?: string`

#### Scenario: Single Graph Shape
- **WHEN** 定义 workflow graph
- **THEN** 系统 MUST 使用 `nodes: Record<string, WorkflowNodeDef>` 这一套结构
- **AND** MUST NOT 在本 change 中再定义平行的 `edges` 结构

### Requirement: WorkflowExecutionService Port

TS 后端 MUST 在 `agent-contracts/core` 中定义：

```ts
execute(
  request: WorkflowExecutionRequest,
  signal: AbortSignal,
  observer?: WorkflowExecutionObserver
): Promise<WorkflowExecutionResult>
```

`WorkflowExecutionRequest` MUST 包含：
- `recipeName`
- `recipeVersion`
- `inputVariables`
- `identityContext`
- `agentId`
- `agentVersion`
- `sessionId`
- `requestId`
- `runId`
- `requestContextId`

`WorkflowExecutionResult` MUST 包含：
- `executionId`
- `status`
- `outputVariables`
- `nodeResults`
- `startedAt`
- `completedAt`

#### Scenario: Port Asynchronous Signature
- **WHEN** 调用 `execute`
- **THEN** 返回值 MUST 是 `Promise<WorkflowExecutionResult>`
- **AND** 方法签名 MUST 接受 `AbortSignal`

#### Scenario: Optional Runtime Observer
- **WHEN** workflow 需要把节点生命周期或安全可见增量内容桥接到上层 runtime
- **THEN** `execute()` MUST 允许接收可选 `WorkflowExecutionObserver`
- **AND** observer MUST 只消费安全的 `WorkflowExecutionEvent`
- **AND** workflow contract MUST NOT 直接依赖 runtime timeline event vocabulary

### Requirement: WorkflowNodeResult

`WorkflowNodeResult` MUST 包含：
- `nodeId`
- `nodeType`
- `status`
- `retryCount`
- `startedAt`
- `completedAt`

`WorkflowNodeResult` MAY 包含：
- `output?`
- `safeError?`

#### Scenario: Minimal Node Result
- **WHEN** workflow engine 返回节点结果
- **THEN** 节点结果 MUST 使用唯一的 `WorkflowNodeResult` 结构
- **AND** 本 change MUST NOT 引入 `nodeAttemptId`、`branchId` 或 distributed owner 字段

### Requirement: WorkflowExecutionEvent

TS 后端 MUST 在 `agent-contracts/core` 中定义 `WorkflowExecutionEvent`，用于节点生命周期观测。

#### Scenario: Safe Event Shape
- **WHEN** engine 发出 `WorkflowExecutionEvent`
- **THEN** event MUST NOT 包含 prompt、raw model output、raw capability result、secret 或 path

#### Scenario: Safe Visible Delta
- **WHEN** 节点需要向用户投影安全的中间可见内容
- **THEN** `WorkflowExecutionEvent` MAY 承载受控的 `visibleDelta`
- **AND** `visibleDelta` MUST 只允许 `CONTENT` 或 `THINKING` 两类 channel
- **AND** `visibleDelta.content` MUST 是安全文本增量
- **AND** contract MUST NOT 引入 workflow 对 runtime `LLM_CONTENT_DELTA` / `LLM_THINKING_DELTA` 的直接依赖

### Requirement: AgentAssembly Recipe Bindings

`AgentAssembly` MUST 增加 `recipeIds?: string[]` 可选字段。

#### Scenario: Optional Recipe Binding
- **WHEN** 构建 `AgentAssembly`
- **THEN** `recipeIds` MUST 是可选字段

### Requirement: Workflow Capability Kind

`CapabilityKind` MUST 使用 `WORKFLOW` 表示可执行 workflow 能力。`RecipeDefinition` 是静态 DSL 资源，不得作为运行时 capability kind。

#### Scenario: Recipe Published For Runtime Execution
- **WHEN** recipe provider 从静态 Recipe 1.0 DSL 生成 capability descriptor
- **THEN** descriptor.kind MUST 为 `WORKFLOW`
- **AND** `RECIPE` MUST NOT 是合法的 `CapabilityKind`

#### Scenario: Resource Vocabulary Preserved
- **WHEN** workflow 解析或执行 recipe 资源
- **THEN** `RecipeDefinition`、`recipeName`、`RECIPE_CHOICE` 和 RAG `indexType: RECIPE` MUST 保持资源语义
- **AND** 不得因 capability kind 统一而改名
