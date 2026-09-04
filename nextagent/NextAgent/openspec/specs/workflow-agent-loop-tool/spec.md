# workflow-agent-loop-tool Specification

## Purpose

定义模型 tool loop 调用当前 Agent Scope 下预置 Workflow 的安全入口。Workflow 仍由现有 workflow execution service 执行；本规格只定义 Tool 输入、可用性校验、结果安全映射、timeline 投影和取消边界。
## Requirements
### Requirement: Workflow Execution Tool Port

`WorkflowExecutionToolPort` MUST 作为 tool 层对 workflow 执行能力的适配契约，由 composition root 实现。它 MUST NOT 直接暴露 `WorkflowExecutionService` 的完整接口，只暴露 tool 执行所需的最小契约。

**输入与前置条件：**
- `recipeName`：recipe 名称（可用性由 `WORKFLOW` capability 判断，definition 由 port 适配器解析）
- `inputText`：可选用户问题文本
- `inputVariables`：可选结构化上下文参数
- `context`：`ToolExecutionContext`，提供 agentId、sessionId、runId、identityContext 等
- `signal`：`AbortSignal`，用于取消

**输出与副作用：**
- 返回 `CapabilityInvocationResult`，由 port 实现负责将 `WorkflowExecutionResult` 映射
- workflow visible delta MUST 通过 callback 或 observer 投影到当前 run timeline

**核心判断逻辑：**
1. 从 `ToolExecutionContext` 读取 agent scope 和 owner scope 字段
2. 调用 app-provided recipe definition source 获取 `RecipeDefinition`（含 `recipeVersion`）
3. 组装 `WorkflowExecutionRequest`（含 `recipeName`、`recipeVersion`、scope 字段、`inputText`、`inputVariables`）
4. 调用 `WorkflowExecutionService.execute()`（local 或 remote 由 app composition 决定）
5. 将 `WorkflowExecutionResult.status` 映射为 `CapabilityInvocationResult.status`
6. 将 `WorkflowExecutionResult.outputVariables` 放入 `structuredPayload`

#### Scenario: Local Mode Execution
- **GIVEN** app composition 配置 `workflowExecutionMode` 为 `local` 或未配置
- **WHEN** Workflow tool 被调用
- **THEN** port 实现 MUST 使用 `createWorkflowExecutionService` 产出的 service 实例执行 workflow

#### Scenario: Remote Mode Execution
- **GIVEN** app composition 配置 `workflowExecutionMode` 为 `remote` 且提供了 `workflowRemoteExecutionGateway`
- **WHEN** Workflow tool 被调用
- **THEN** port 实现 MUST 使用 `createRemoteWorkflowExecutionService` 产出的 service 实例执行 workflow

### Requirement: Scope Inheritance

Workflow tool 执行 MUST 继承当前请求的 Agent Scope 和 Owner Scope，不创建子 session，不改变 `agentId` 或 `identityContext`。

**输入与前置条件：**
- `ToolExecutionContext.agentId`、`ToolExecutionContext.identityContext` MUST 与当前 run 一致
- `WorkflowExecutionRequest` 中的 `agentId`、`agentVersion`、`identityContext`、`sessionId`、`runId` MUST 来自 `ToolExecutionContext`

**核心判断逻辑：**
1. 从 `ToolExecutionContext` 读取 agent scope 和 owner scope 字段
2. 直接映射到 `WorkflowExecutionRequest`，不做替换或降级
3. workflow 在同一 scope 内执行，结果回灌到当前 run 上下文

#### Scenario: Same Agent Scope
- **WHEN** Workflow tool 在 agent loop 中被执行
- **THEN** `WorkflowExecutionRequest.agentId` MUST 等于 `ToolExecutionContext.agentId`
- **AND** workflow 执行 MUST NOT 创建新的 session 或 run

#### Scenario: Same Owner Scope
- **WHEN** Workflow tool 在 agent loop 中被执行
- **THEN** `WorkflowExecutionRequest.identityContext` MUST 等于 `ToolExecutionContext.identityContext`
- **AND** workflow 内的 capability 调用 MUST 受同一 owner scope 约束

### Requirement: Timeline Event Projection

Workflow 执行中的 visible delta 和 node 事件 MUST 通过 observer 投影到当前 run 的 timeline，使前端和 observability 能看到 workflow 执行进度。

**触发机制：**
- Workflow tool 执行期间，`WorkflowExecutionService` 通过 observer callback 发出 `WorkflowExecutionEvent`

**输出与副作用：**
- `WorkflowVisibleDelta` 投影为 `LLM_CONTENT_DELTA` 或等价 timeline event
- node 级别 diagnostic 投影为安全可观测的 timeline event
- 投影 MUST NOT 包含 secret、raw model output 或 raw capability payload

#### Scenario: Visible Delta Projected To Timeline
- **WHEN** workflow 执行中通过 observer 发出 `WorkflowVisibleDelta`
- **THEN** 系统 MUST 将其投影为当前 run 的 timeline event
- **AND** 前端 MUST 能通过 stream 收到该 delta

### Requirement: Abort And Timeout

Workflow tool 执行 MUST 响应 `AbortSignal` 和 tool execution timeout，在取消或超时时安全终止 workflow。

**触发机制：**
- `ToolExecutionContext.signal` abort 时
- tool execution timeout 到达时（由 `ToolExecutionContext.timeoutMs` 控制）

**核心判断逻辑：**
1. 将 `ToolExecuteOptions.signal` 传递给 `WorkflowExecutionToolPort.execute()`
2. port 实现将 signal 传递给 `WorkflowExecutionService.execute()`
3. signal abort 时 workflow engine 中断当前节点执行

**失败与降级：**
- abort → engine 返回 `INTERRUPTED` → `FAILED`，safeError category `CANCELED`

#### Scenario: Abort Cancels Workflow
- **WHEN** tool execution signal 被 abort
- **THEN** workflow 执行 MUST 被中断
- **AND** `CapabilityInvocationResult.status` MUST 为 `"FAILED"`，safeError category `"CANCELED"`

### Requirement: Tool Dependency Declaration

`Workflow` tool MUST 声明 `requiredDependencies: ["workflowExecution"]`，使 tool catalog 在依赖未注入时将该 tool 标记为 `UNAVAILABLE`。

`ToolDependencyName` 和 `ToolDependencies` 在 `agent-capability/tool-spi.ts` 和 `agent-contracts/capability` 中有双份定义，两处 MUST 同步新增 `workflowExecution`。`tool-catalog.ts` 的 `allowedDependencyNames` 校验集 MUST 同步新增 `"workflowExecution"`，否则 catalog 构造时抛 `CapabilityConfigurationError`。

**输入与前置条件：**
- `ToolDependencies.workflowExecution` MUST 在 app composition 中注入

**核心判断逻辑：**
1. `BuiltinToolCatalog` 在构造时检查 `requiredDependencies`
2. 如果 `workflowExecution` 未注入，descriptor `availabilityStatus` 为 `UNAVAILABLE`，`availabilityReason` 为 `TOOL_DEPENDENCY_MISSING`
3. 模型不会在 tool 列表中看到该 tool

#### Scenario: Dependency Missing Marks Tool Unavailable
- **GIVEN** app composition 未注入 `workflowExecution` 依赖
- **WHEN** context engine 查询 `listAvailable({ modelInvocable: true, includeUnavailable: false })`
- **THEN** `Workflow` tool MUST NOT 出现在返回的 capability 列表中
- **AND** 模型 MUST NOT 能选到该 tool

#### Scenario: Dependency Present Enables Tool
- **GIVEN** app composition 注入了 `workflowExecution` 依赖
- **WHEN** context engine 查询 `listAvailable({ modelInvocable: true, includeUnavailable: false })`
- **THEN** `Workflow` tool MUST 出现在返回的 capability 列表中，`availabilityStatus` 为 `AVAILABLE`
