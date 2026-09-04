# workflow-remote-execution-mode Specification

## Purpose
定义工作流本地与远程执行模式的选择条件、执行边界和可观察结果，使调用方能在一致的工作流语义下获得可验证的执行结果和失败反馈。
## Requirements
### Requirement: Workflow Execution Mode Selection

TS 后端 MUST 支持 `WorkflowExecutionMode`（`"local"` | `"remote"`）选择 workflow 执行位置，默认 `"local"`。模式 MUST 只影响 `WorkflowExecutionService` 实例的构造来源；`agent-core` 消费方调用 `execute(request, signal, observer, runtime)` 的签名和行为契约 MUST NOT 因模式不同而变化。模式选择 MUST 来自可信 app composition 配置，MUST NOT 来自请求体、模型输出、capability 参数或客户端 metadata。remote 模式下 `execute` 的触发点与 local 模式一致：`agent-core` 的 `DefaultAgent` 在 routing 命中 recipe（`targetRecipe` 或 boot-recipe）时，于 request lifecycle 的 agent execution 阶段调用 `WorkflowExecutionService.execute()`，同步等待 `Promise<WorkflowExecutionResult>` 但内部通过 `AsyncIterable` 流式回放事件。

设计入口：`openspec/designs/architecture/workflow-remote-execution-mode.md`

#### Scenario: Default Local Mode
- **WHEN** `agent-app` 启动时未配置 workflow execution mode
- **THEN** 系统 MUST 使用 local 模式构造 `WorkflowExecutionService`
- **AND** `agent-core` 消费方 MUST 通过同一 `WorkflowExecutionService` 端口调用

#### Scenario: Explicit Remote Mode
- **WHEN** 可信配置指定 `WorkflowExecutionMode` 为 `"remote"` 且远端 gateway 依赖可用
- **THEN** `agent-app` MUST 构造 remote `WorkflowExecutionService` 实例
- **AND** `agent-core` 消费方 MUST 通过同一 `WorkflowExecutionService` 端口调用
- **AND** 调用签名 MUST 与 local 模式一致

#### Scenario: Remote Mode Without Gateway Dependency
- **WHEN** 可信配置指定 `"remote"` 但远端 gateway 依赖缺失
- **THEN** `agent-app` 启动 MUST 失败

#### Scenario: Mode Source Is Trusted
- **WHEN** 请求体、模型输出或 capability 参数携带 workflow execution mode 字段
- **THEN** 系统 MUST NOT 使用该字段覆盖可信 composition 配置的模式

### Requirement: Remote Execution Gateway Port

TS 后端 MUST 在 `agent-contracts/core` 定义 `WorkflowRemoteExecutionGateway` port，作为远端 workflow 执行的传输契约，与 `WorkflowExecutionService` 同属 workflow 执行契约族。该 port MUST 是 async contract，接收 `WorkflowExecutionRequest` 和 `AbortSignal`，返回 `AsyncIterable<WorkflowRemoteExecutionStreamItem>`。`WorkflowRemoteExecutionStreamItem` MUST 是 discriminated union：`kind: "event"` 携带 `WorkflowExecutionEvent`（按产生顺序流式产出），`kind: "result"` 携带最终 `WorkflowExecutionResult`，`kind: "failure"` 携带远端失败的 `reasonCode` 和 `message`。gateway port MUST NOT 承载 request lifecycle、terminal commit 或 runtime timeline ownership。port 定义放在 `agent-contracts/core` 而非 `agent-contracts/gateway`，因为 gateway subpath MUST NOT 依赖 core 业务 subpath，而本 port 需要携带 `WorkflowExecutionRequest`/`WorkflowExecutionResult`/`WorkflowExecutionEvent` 等 core 契约类型。

设计入口：`openspec/designs/architecture/workflow-remote-execution-mode.md`

#### Scenario: Async Iterable Contract With Cancellation
- **WHEN** 调用 `WorkflowRemoteExecutionGateway.execute`
- **THEN** 返回值 MUST 是 `AsyncIterable<WorkflowRemoteExecutionStreamItem>`
- **AND** 方法签名 MUST 接收 `AbortSignal`

#### Scenario: Stream Produces Events Then Terminal Item
- **WHEN** 远端服务执行 recipe
- **THEN** gateway port MUST 流式产出 `kind: "event"` 项（零个或多个 `WorkflowExecutionEvent`）
- **AND** 最终 MUST 产出一个 `kind: "result"` 或 `kind: "failure"` 终止项
- **AND** event 项 MUST 在终止项之前产出

#### Scenario: Gateway Does Not Own Lifecycle
- **WHEN** 远端 gateway 完成调用
- **THEN** gateway MUST NOT 持有 request lifecycle、terminal commit 或 runtime timeline ownership
- **AND** 这些职责 MUST 留在 `agent-core` 和 `agent-runtime`

### Requirement: Remote Safe Error Mapping

远端 workflow 执行的失败 MUST 映射为 `SafeError`，MUST NOT 泄露 prompt、raw model output、raw provider error、path、credential 或高基数字段。远端不可达、超时、未授权和非法响应 MUST 产生对应 `reasonCode` 的 `SafeError`，并使 `WorkflowExecutionResult.status` 为 `"FAILED"`。`WorkflowRemoteExecutionStreamItem` 的 `kind: "failure"` 项中的 `reasonCode` MUST 映射到 `SafeError.code` 和 `SafeError.safeDetails.reasonCode`；`SafeError.message` MUST 是安全摘要文本，MUST NOT 包含远端返回的原始 message。

设计入口：`openspec/designs/architecture/workflow-remote-execution-mode.md`

#### Scenario: Remote Unreachable
- **WHEN** 远端服务不可达
- **THEN** 系统 MUST 返回 status 为 `"FAILED"` 的 `WorkflowExecutionResult`
- **AND** `SafeError` MUST 在 `code` 和 `safeDetails.reasonCode` 中携带 `"WORKFLOW_REMOTE_UNAVAILABLE"`
- **AND** `SafeError` MUST NOT 包含 path、credential 或 raw provider error

#### Scenario: Remote Timeout
- **WHEN** 远端调用在 `AbortSignal` 触发前未完成或远端返回超时
- **THEN** 系统 MUST 返回 status 为 `"FAILED"` 的 `WorkflowExecutionResult`
- **AND** `SafeError` MUST 在 `code` 和 `safeDetails.reasonCode` 中携带 `"WORKFLOW_REMOTE_TIMEOUT"`

#### Scenario: Remote Unauthorized
- **WHEN** 远端服务返回 401 或 403
- **THEN** 系统 MUST 返回 status 为 `"FAILED"` 的 `WorkflowExecutionResult`
- **AND** `SafeError` MUST 在 `code` 和 `safeDetails.reasonCode` 中携带 `"WORKFLOW_REMOTE_UNAUTHORIZED"`

#### Scenario: Remote Invalid Response
- **WHEN** 远端服务返回无法解析的响应或 SSE 流中断
- **THEN** 系统 MUST 返回 status 为 `"FAILED"` 的 `WorkflowExecutionResult`
- **AND** `SafeError` MUST 在 `code` 和 `safeDetails.reasonCode` 中携带 `"WORKFLOW_REMOTE_INVALID_RESPONSE"`

### Requirement: Remote Response Schema Validation

远端 SSE 流解析的 JSON payload MUST 在到达 `RemoteWorkflowExecutionService` 前通过 TypeBox schema 校验。fetch 适配器定义本地流类型（仅依赖 `agent-common` 词汇表），event/result payload 以 `JsonObject` 透传；`agent-app` 桥接层 `adaptFetchWorkflowRemoteGateway` 把 fetch 适配器适配为 `WorkflowRemoteExecutionGateway` 端口，在桥接中对 `kind: "event"` 项的 payload 通过 `WorkflowExecutionEventSchema` 校验，对 `kind: "result"` 项的 payload 通过 `WorkflowExecutionResultSchema` 校验。校验失败的 payload MUST 映射为 `kind: "failure"` + `WORKFLOW_REMOTE_INVALID_RESPONSE`，MUST NOT yield 未校验的 payload。这与 SkillHub 端口-适配器分离模式同形同策。

设计入口：`openspec/designs/architecture/workflow-remote-execution-mode.md`

#### Scenario: Valid Payload Passes Validation
- **WHEN** 远端 SSE 帧的 JSON payload 符合 `WorkflowExecutionEventSchema` 或 `WorkflowExecutionResultSchema`
- **THEN** fetch 适配器 MUST yield 对应的 `WorkflowRemoteExecutionStreamItem`
- **AND** MUST NOT 跳过 schema 校验

#### Scenario: Invalid Payload Mapped To Failure
- **WHEN** 远端 SSE 帧的 JSON payload 不符合对应 schema
- **THEN** fetch 适配器 MUST yield `kind: "failure"` + `reasonCode` 为 `"WORKFLOW_REMOTE_INVALID_RESPONSE"`
- **AND** MUST NOT yield 未校验的 payload

### Requirement: Remote Observer Event Streaming

remote 模式下，远端服务产生的 `WorkflowExecutionEvent` MUST 在到达时实时回放到本地 `WorkflowExecutionObserver`，而非批量回放。回放顺序 MUST 与事件产生顺序一致。回放的 event MUST 使用 workflow-layer safe event vocabulary，MUST NOT 直接写入 runtime timeline。实时回放使 `agent-core` 的 `WorkflowRuntimeEventProjector` 能在远端执行期间实时投影为 `RunTimelineEvent`，供 runtime 持久化和 web channel 页面呈现。

#### Scenario: Events Streamed In Real Time
- **WHEN** 远端服务执行期间产出 `WorkflowExecutionEvent`
- **THEN** `RemoteWorkflowExecutionService` MUST 在每个 `kind: "event"` 项到达时立即调用 `observer.emitEvent`
- **AND** 不得等待所有 event 收集完后才回放
- **AND** 所有 event 回放完成后才返回终止项的 `WorkflowExecutionResult`

#### Scenario: No Observer No Streaming Failure
- **WHEN** 调用方未传入 `observer`
- **THEN** `RemoteWorkflowExecutionService` MUST 跳过 event 回放
- **AND** MUST 仍正常消费流并返回 `WorkflowExecutionResult`

#### Scenario: Safe Event Vocabulary Preserved
- **WHEN** 远端服务产出 event
- **THEN** 回放的 event MUST NOT 包含 prompt、raw model output、raw capability result、secret 或 path
- **AND** event MUST 保持 workflow-layer `WorkflowExecutionEvent` 形状

#### Scenario: Streamed Events Enter Runtime Timeline
- **WHEN** `RemoteWorkflowExecutionService` 回放 event 到 `observer.emitEvent`
- **THEN** `agent-core` 的 `WorkflowRuntimeEventProjector` MUST 能实时投影为 `RunTimelineEvent`
- **AND** 投影后的 timeline 事件 MUST 通过 `runState.emitEvent` 写入 canonical timeline
- **AND** canonical timeline 事件 MUST 由 runtime 持久化并可被 web channel 投影为 stream envelope 供页面呈现

### Requirement: Remote Cancellation Propagation

remote 模式下，调用方传入的 `AbortSignal` MUST 传播到 `WorkflowRemoteExecutionGateway`。当 `AbortSignal` 被触发时，远端 gateway 调用 MUST 被取消，且 `RemoteWorkflowExecutionService` MUST 返回 status 为 `"INTERRUPTED"` 的 `WorkflowExecutionResult`。

#### Scenario: Abort Propagated To Gateway
- **WHEN** 调用方触发 `AbortSignal`
- **THEN** `WorkflowRemoteExecutionGateway` 的底层 SSE 连接 MUST 收到取消
- **AND** `RemoteWorkflowExecutionService` MUST 返回 status 为 `"INTERRUPTED"` 的结果
- **AND** 已回放的 event 仍保留在 runtime timeline 中

#### Scenario: Abort Before Gateway Call
- **WHEN** `AbortSignal` 在调用 gateway 前已触发
- **THEN** `RemoteWorkflowExecutionService` MUST 不发起远端请求
- **AND** MUST 返回 status 为 `"INTERRUPTED"` 的结果

### Requirement: Remote Pending Input Bridging

remote 模式下，当远端服务返回 status 为 `"WAITING"` 的结果时，`RemoteWorkflowExecutionService` MUST 通过本地 `runtime.requestPendingInput` 把远端 pending input 注册为本地 pending input，并把本地 pending input id 回填到返回结果的 `pendingInput` 中。resume 流程 MUST 复用 `WorkflowExecutionRequest.resumeState`，与 local 模式一致。

#### Scenario: Waiting Result Bridged Locally
- **WHEN** 远端服务返回 status 为 `"WAITING"` 且包含 pending input 信息
- **THEN** `RemoteWorkflowExecutionService` MUST 调用本地 `runtime.requestPendingInput` 注册 pending input
- **AND** 返回结果的 `pendingInput` MUST 包含本地 pending input id

#### Scenario: Waiting Without Runtime Callback
- **WHEN** 远端服务返回 `"WAITING"` 但调用方未传入 `runtime`
- **THEN** `RemoteWorkflowExecutionService` MUST 返回 status 为 `"FAILED"` 的结果
- **AND** `SafeError` MUST 在 `code` 和 `safeDetails.reasonCode` 中携带 `"WORKFLOW_REMOTE_PENDING_INPUT_RUNTIME_MISSING"`

#### Scenario: Resume Consistent With Local
- **WHEN** 调用方在 pending input 回答后再次调用 `execute` 且 `request.resumeState` 携带答案
- **THEN** `RemoteWorkflowExecutionService` MUST 把 `resumeState` 透传给远端 gateway
- **AND** resume 行为 MUST 与 local 模式的 `WorkflowExecutionService` 端口契约一致

### Requirement: Remote Scope Integrity

remote 模式下，`WorkflowExecutionRequest` 中的 `agentId`、`agentVersion`、`agentAssemblyRef`、`sessionId`、`requestId`、`runId`、`requestContextId` 和 `identityContext` 等 owner scope 与 agent scope 字段 MUST 来自可信 app composition 或已持久化领域对象，MUST NOT 被远端响应覆盖。

#### Scenario: Scope Fields Not Overridden By Remote
- **WHEN** 远端服务返回的结果中包含 scope 相关字段
- **THEN** `RemoteWorkflowExecutionService` MUST NOT 用远端返回的 scope 字段覆盖本地请求中的 scope 字段
- **AND** 返回结果的 scope 相关信息 MUST 以本地请求为准

#### Scenario: Safe Error Does Not Leak Scope Credentials
- **WHEN** 远端调用失败并映射为 `SafeError`
- **THEN** `SafeError` MUST NOT 包含 credential、token、path 或高基数字段

### Requirement: Remote Execution Lifecycle Logging

`RemoteWorkflowExecutionService` MUST 在关键生命周期节点通过 `RuntimeLogger` 记录结构化日志，包括 execute 开始、终止项到达、失败映射、abort 触发和 pending input 桥接。日志 event 命名 MUST 以 `workflow.remote.` 前缀，与 local engine 的 `workflow.` 前缀同形同策。日志字段 MUST NOT 包含 prompt、raw model output、raw provider error、path、credential、token 或高基数字段。

设计入口：`openspec/designs/architecture/workflow-remote-execution-mode.md`

#### Scenario: Started Log On Execute Begin
- **WHEN** `RemoteWorkflowExecutionService.execute` 被调用
- **THEN** MUST 记录 `workflow.remote.started` info 级别日志
- **AND** 日志字段 MUST 包含 executionId、recipeName、recipeVersion、hasResumeState
- **AND** MUST NOT 包含 prompt、credential 或高基数字段

#### Scenario: Result Log On Terminal Item
- **WHEN** 收到 `kind: "result"` 终止项
- **THEN** MUST 记录 `workflow.remote.result` info 级别日志
- **AND** 日志字段 MUST 包含 executionId 和 status

#### Scenario: Failure Log On Failure Item
- **WHEN** 收到 `kind: "failure"` 项
- **THEN** MUST 记录 `workflow.remote.failed` error 级别日志
- **AND** 日志字段 MUST 包含 executionId 和 reasonCode

#### Scenario: Abort Log On Signal Trigger
- **WHEN** AbortSignal 被触发
- **THEN** MUST 记录 `workflow.remote.aborted` warn 级别日志
- **AND** 日志字段 MUST 包含 executionId

#### Scenario: Pending Input Bridge Log
- **WHEN** 远端返回 WAITING 且 pending input 桥接成功
- **THEN** MUST 记录 `workflow.remote.pending_input.bridged` info 级别日志
- **AND** 日志字段 MUST 包含 executionId 和 pendingInputKind

#### Scenario: Pending Input Missing Runtime Log
- **WHEN** 远端返回 WAITING 但 runtime 不可用
- **THEN** MUST 记录 `workflow.remote.pending_input.missing_runtime` error 级别日志
- **AND** 日志字段 MUST 包含 executionId

#### Scenario: No Sensitive Fields In Logs
- **WHEN** `RemoteWorkflowExecutionService` 记录任何日志
- **THEN** 日志 MUST NOT 包含 prompt、raw model output、raw provider error、path、credential、token 或高基数字段

### Requirement: User Input And Recipe Variable Separation

WorkflowExecutionRequest MUST 用 inputText 字段承载用户原始自然语言输入，用 inputVariables 承载 recipe 业务参数。两者 MUST 在 contract 层面语义独立，inputVariables MUST NOT 包含用户原始问题。gent-core 构建 request 时 MUST 从可信 flow variables 的 input_question 提取设置 inputText。gent-workflow local engine MUST 在初始化执行变量时将 inputText 注入为 input_question，使节点行为不变。remote service MUST 整体透传 request（含 inputText），远端可直接区分用户输入与 recipe 参数。

设计入口：openspec/designs/architecture/workflow-remote-execution-mode.md

#### Scenario: inputText Carries User Question
- **WHEN** gent-core 构建 WorkflowExecutionRequest 且 flow variables 包含 input_question`r
- **THEN** request MUST 设置 inputText 为用户原始问题
- **AND** inputVariables MUST NOT 包含 input_question`r

#### Scenario: Local Engine Injects input_question
- **WHEN** local engine 执行 request 且 inputText 非空
- **THEN** 执行变量 MUST 包含 input_question（值为 inputText）
- **AND** 节点读取 ariables.input_question 的行为 MUST NOT 变化

#### Scenario: Remote Request Preserves Separation
- **WHEN** remote service 将 request 透传给 gateway
- **THEN** gateway 收到的 request MUST 包含独立的 inputText 和 inputVariables`r
- **AND** inputVariables MUST NOT 包含用户原始问题
