## ADDED Requirements

### Requirement: Workflow Tool Availability

`Workflow` MUST be a builtin TOOL-kind capability registered in `builtinToolDefinitions`，与现有 builtin tools 并列。它 MUST 通过标准 tool catalog → capability catalog → context engine 路径暴露给模型，使模型在 model-driven loop 中能够选到该 tool。

**触发机制：**
- 模型在 tool loop 中生成 `toolCalls` 包含 `toolName: "Workflow"` 时触发
- 由 `executeToolCallsInOrder` 通过标准 capability invocation 路径执行

**输入与前置条件：**
- `recipeName`：非空字符串，必须命中当前 Agent Scope 的 `WORKFLOW` capability
- `inputText`：可选字符串，用户原始问题文本
- `inputVariables`：可选 JSON object，结构化上下文参数
- `WorkflowExecutionToolPort` 依赖 MUST 已注入

**输出与副作用：**
- 返回 `CapabilityInvocationResult`，`structuredPayload` 包含 workflow 执行结果
- workflow 执行中的 visible delta 通过 observer 投影到当前 run timeline
- workflow 执行不创建子 session，在当前 Agent Scope / Owner Scope 内执行

**核心判断逻辑：**
1. 校验 `inputVariables` 是合法 JSON object
2. 调用 `WorkflowExecutionToolPort.execute()`，传入 recipeName、inputText、inputVariables 和当前 tool execution context
3. Port 适配器通过 app-provided recipe definition source 解析 recipe（含 recipeVersion）
4. 将 `WorkflowExecutionResult` 映射为 `CapabilityInvocationResult` 返回

**状态 / 产物契约：**
- `structuredPayload` MUST 包含 `recipeName`、`status` 和 `outputVariables` 摘要
- `structuredPayload` MUST NOT 包含 secret、credential 或 raw provider error
- `metadata` MAY 包含 `executionId`、`nodeResultCount` 等安全可追溯键

**失败与降级：**
- recipe 不存在 → `FAILED`，safeError category `VALIDATION`
- workflow 执行被 abort → engine 返回 `INTERRUPTED` → `FAILED`，safeError category `CANCELED`
- workflow 执行失败 → `FAILED`，safeError 从 workflow safeError 映射
- workflow 等待用户输入 → `DEGRADED`，structuredPayload 携带 pendingInput 摘要

#### Scenario: Model Selects Workflow Tool After Skill Guidance
- **GIVEN** model-driven loop 中模型已通过 Skill tool 加载了一个 inline skill
- **AND** 该 skill body 指示模型对于特定任务应调用 `Workflow` tool 并给出 `recipeName`
- **WHEN** 模型生成 toolCall `toolName: "Workflow"`，`arguments: { recipeName: "alarm-localization", inputText: "基站告警频繁" }`
- **THEN** 系统 MUST 通过标准 capability invocation 路径执行 Workflow tool
- **AND** 返回的 `CapabilityInvocationResult.structuredPayload` MUST 包含 `recipeName` 和 `status`

#### Scenario: Recipe Not Found
- **WHEN** 模型调用 Workflow tool 时 `recipeName` 未命中当前 Agent Scope 的 `WORKFLOW` capability 或 definition source
- **THEN** 系统 MUST 返回 `FAILED`，safeError category `VALIDATION`
- **AND** safeError message MUST NOT 泄露 recipe 文件路径或 registry 内部结构

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

### Requirement: Workflow Result To Capability Result Mapping

Workflow tool MUST 将 `WorkflowExecutionResult` 安全映射为 `CapabilityInvocationResult`，不泄露 secret、raw provider error 或 workflow 内部实现细节。

`WorkflowExecutionStatus` 实际枚举值为 `"COMPLETED" | "FAILED" | "INTERRUPTED" | "WAITING"`。

**映射规则：**
- `COMPLETED` → `status: "SUCCEEDED"`，`structuredPayload` 包含 `recipeName`、`status: "succeeded"`、`outputVariables`
- `FAILED` → `status: "FAILED"`，`safeError` 从 workflow nodeResults 中提取最后一个失败节点的 safeError
- `INTERRUPTED` → `status: "FAILED"`，`safeError` category `CANCELED`，`retryable: false`
- `WAITING`（pending input）→ `status: "DEGRADED"`，`structuredPayload` 携带 `pendingInput` 摘要（kind、questions prompt、options label），`safeError.code` 为 `WORKFLOW_PENDING_INPUT`
- `structuredPayload` 在所有状态分支 MUST 包含 `answerPreviews`，从 `nodeResults` 中 `output.level === "answer"` 的 `content` 字段提取，每条截断至 4000 字符，最多 10 条；空数组表示无 answer 级输出
- `outputVariables` 中的值 MUST 经过安全过滤，不包含 secret keyword pattern 匹配的内容

注意：`SafeError` 没有 `reasonCode` 字段，使用 `code` 字段携带 `WORKFLOW_PENDING_INPUT` 标识。

**核心判断逻辑：**
1. 读取 `WorkflowExecutionResult.status`
2. 按 status 分支映射
3. 提取 `outputVariables` 并做安全过滤
4. 提取 nodeResults 中的诊断信息放入 `metadata`
5. 从 nodeResults 中提取 `output.level === "answer"` 的 content 放入 `structuredPayload.answerPreviews`

#### Scenario: Completed Workflow Returns Output Variables
- **WHEN** workflow 执行返回 `status: "COMPLETED"`
- **THEN** `CapabilityInvocationResult.status` MUST 为 `"SUCCEEDED"`
- **AND** `structuredPayload.outputVariables` MUST 包含 workflow 产出变量
- **AND** `structuredPayload` MUST NOT 包含 secret 或 credential

#### Scenario: Interrupted Workflow Returns Canceled
- **WHEN** workflow 执行返回 `status: "INTERRUPTED"`
- **THEN** `CapabilityInvocationResult.status` MUST 为 `"FAILED"`
- **AND** `safeError.category` MUST 为 `"CANCELED"`

#### Scenario: Waiting Workflow Returns Pending Input Summary
- **WHEN** workflow 执行返回 `status: "WAITING"` 且携带 `pendingInput`
- **THEN** `CapabilityInvocationResult.status` MUST 为 `"DEGRADED"`
- **AND** `structuredPayload.pendingInput` MUST 包含 `kind` 和 `questions` 摘要
- **AND** `safeError.code` MUST 为 `"WORKFLOW_PENDING_INPUT"`

#### Scenario: Answer Previews Extracted From Node Results
- **WHEN** workflow 执行返回 `status: "COMPLETED"` 且 `nodeResults` 包含 `output.level === "answer"` 的节点
- **THEN** `structuredPayload.answerPreviews` MUST 包含这些节点的 content 字段
- **AND** 每条 preview MUST 不超过 4000 字符
- **AND** `answerPreviews` 最多包含 10 条

#### Scenario: Secret Exclusion From Output
- **WHEN** workflow `outputVariables` 中包含匹配 secret keyword pattern 的字段
- **THEN** 映射逻辑 MUST 过滤或 mask 该字段
- **AND** `structuredPayload` MUST NOT 包含 secret 明文

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
