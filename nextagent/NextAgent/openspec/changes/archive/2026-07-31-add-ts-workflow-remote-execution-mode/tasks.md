## 1. Gateway Port 契约

- [x] 1.1 在 `agent-contracts/core` 定义 `WorkflowRemoteExecutionGateway` port、`WorkflowRemoteExecutionStreamItem` discriminated union 和 `WorkflowRemoteExecutionFailureReasonCode` 类型。port 是 async contract，`execute(request, signal)` 返回 `AsyncIterable<WorkflowRemoteExecutionStreamItem>`。`WorkflowRemoteExecutionStreamItem` 是 discriminated union：`kind: "event"` 携带 `WorkflowExecutionEvent`，`kind: "result"` 携带 `WorkflowExecutionResult`，`kind: "failure"` 携带 `reasonCode` + `message`。复用 core 现有 `WorkflowExecutionRequest`/`Result`/`Event` 类型，不新增平行 DTO。
  验证：`npm run build`；`npm run test:contract -- --run workflow-remote-gateway`
  来源：spec `Remote Execution Gateway Port`；design 决策 2

- [x] 1.2 为 `WorkflowRemoteExecutionGateway` port 添加 contract 测试，断言 AsyncIterable 签名、AbortSignal 接收、流式产出 event 项后终止项、gateway 不持有 lifecycle ownership。
  验证：`npm run test:contract -- --run workflow-remote-gateway`
  来源：spec `Remote Execution Gateway Port` / `Gateway Does Not Own Lifecycle`

## 2. RemoteWorkflowExecutionService 实现

- [x] 2.1 在 `agent-workflow` 新增 `createRemoteWorkflowExecutionService(options)` 和 `RemoteWorkflowExecutionService`，实现 `WorkflowExecutionService` 端口。`execute` 委托给 `WorkflowRemoteExecutionGateway.execute(request, signal)`，处理成功响应（回放 events、返回 result）、失败响应（映射为 FAILED + SafeError）和 abort（返回 INTERRUPTED）。
  验证：`npm run build`；`npm test -- --run workflow-remote-service`
  来源：spec `Workflow Execution Mode Selection` / `Remote Safe Error Mapping` / `Remote Cancellation Propagation`；design 决策 4

- [x] 2.2 实现流式 event 实时回放：消费 `AsyncIterable` 时，每个 `kind: "event"` 项在到达时立即调用 `observer.emitEvent`；无 observer 时跳过但不失败；回放的 event 保持 workflow-layer safe event vocabulary。
  验证：`npm test -- --run workflow-remote-event-streaming`
  来源：spec `Remote Observer Event Streaming`；design 决策 6

- [x] 2.3 实现 pending input 桥接：远端返回 `WAITING` 时，从 pending input payload 提取 kind/questions/resumeState，调用 `runtime.requestPendingInput` 注册本地 pending input，把本地 id 回填到返回结果。`WAITING` 但 `runtime` 不可用时返回 `FAILED` + `WORKFLOW_REMOTE_PENDING_INPUT_RUNTIME_MISSING`。
  验证：`npm test -- --run workflow-remote-pending-input`
  来源：spec `Remote Pending Input Bridging`；design 决策 5

- [x] 2.4 实现 resume 透传：调用方以 `resumeState` 再次调用 `execute` 时，`RemoteWorkflowExecutionService` 透传 `resumeState` 给远端 gateway，行为与 local 模式端口契约一致。
  验证：`npm test -- --run workflow-remote-resume`
  来源：spec `Remote Pending Input Bridging` / `Resume Consistent With Local`；design 决策 5

- [x] 2.5 实现 scope 完整性：`RemoteWorkflowExecutionService` 不用远端返回的 scope 字段覆盖本地请求中的 owner/agent scope 字段。
  验证：`npm test -- --run workflow-remote-scope-integrity`
  来源：spec `Remote Scope Integrity`；design 决策 7

- [x] 2.6 导出 `createRemoteWorkflowExecutionService` 从 `agent-workflow` public exports。
  验证：`npm run build`；`npm run lint:architecture`
  来源：spec `workflow-package` / `Package Structure and Exports`；design 决策 4

- [x] 2.7 实现生命周期日志：`RemoteWorkflowExecutionService` 接收 `runtimeLogger`（默认 `noopRuntimeLogger`），在 execute 开始（`workflow.remote.started`）、终止项到达（`workflow.remote.result`）、failure 映射（`workflow.remote.failed`）、abort 触发（`workflow.remote.aborted`）、pending input 桥接成功（`workflow.remote.pending_input.bridged`）、pending input runtime 缺失（`workflow.remote.pending_input.missing_runtime`）时记录结构化日志。日志字段不含 prompt、raw model output、raw provider error、path、credential 或高基数字段。
  验证：`npm test -- --run workflow-remote-logging`
  来源：spec `Remote Execution Lifecycle Logging`；design 决策 9

## 3. Fetch 适配器

- [x] 3.1 在 `agent-platform-gateway-remote` 新增 `createFetchWorkflowRemoteExecutionGateway` 工厂和 `FetchWorkflowRemoteExecutionGatewayAdapter`，实现本地接口 `FetchWorkflowRemoteExecutionGateway`（仅依赖 `agent-common` 词汇表，不引用 `agent-contracts/core`）。`agent-app` 桥接层 `adaptFetchWorkflowRemoteGateway` 把 fetch 适配器适配为 `WorkflowRemoteExecutionGateway` 端口，与 SkillHub 端口-适配器分离模式同形同策。复用 `SkillHubRemoteGatewayAdapter` 模式：fetch + AbortSignal + credentialResolver + safe error mapping。通过 HTTP SSE（`text/event-stream`）消费远端流式响应，逐个 yield `WorkflowRemoteExecutionStreamItem`。把 HTTP 401/403 映射为 `kind: "failure"` + `WORKFLOW_REMOTE_UNAUTHORIZED`，网络错误映射为 `WORKFLOW_REMOTE_UNAVAILABLE`，超时映射为 `WORKFLOW_REMOTE_TIMEOUT`，SSE 解析失败或连接断开映射为 `WORKFLOW_REMOTE_INVALID_RESPONSE`。SSE 解析出的 JSON payload MUST 在 yield 前通过 TypeBox schema 校验（`WorkflowExecutionEventSchema` / `WorkflowExecutionResultSchema`），校验失败映射为 `kind: "failure"` + `WORKFLOW_REMOTE_INVALID_RESPONSE`。
  验证：`npm run build`；`npm test -- --run workflow-remote-fetch-adapter`
  来源：spec `Remote Safe Error Mapping` / `Remote Response Schema Validation`；design 决策 3

- [x] 3.2 为 fetch 适配器添加 safe error negative 测试，断言 SafeError 不包含 path、credential、raw provider error 或高基数字段。
  验证：`npm test -- --run workflow-remote-redaction`
  来源：spec `Remote Safe Error Mapping` / `Remote Scope Integrity`；design 质量属性-安全

- [x] 3.3 为 SSE payload schema 校验添加 negative 测试，断言不符合 `WorkflowExecutionEventSchema` 或 `WorkflowExecutionResultSchema` 的 payload 被映射为 `kind: "failure"` + `WORKFLOW_REMOTE_INVALID_RESPONSE`，不被 yield 为 event 或 result。
  验证：`npm test -- --run workflow-remote-schema-validation`
  来源：spec `Remote Response Schema Validation`；design 决策 3

## 4. Composition 注入

- [x] 4.1 为 composition 优先级添加测试，断言当 `workflowExecutionServiceFactory` 提供时优先于 `workflowExecutionMode` 选择；当未提供 factory 时按 mode 选择 local 或 remote 实现。不修改 `WorkflowExecutionServiceFactoryOptions`。
  验证：`npm test -- --run workflow-remote-composition-priority`
  来源：spec `workflow-package` / `Custom Factory Overrides Mode Selection`；design 决策 8

- [x] 4.2 在 `agent-app` 的 `CreateComposedAppOptions` 新增 `workflowExecutionMode?: WorkflowExecutionMode` 和 `workflowRemoteExecutionGateway?: WorkflowRemoteExecutionGateway` 配置入口。`createComposedApp` 中按模式选择 local 或 remote 实现：若 `workflowExecutionServiceFactory` 提供则优先使用，否则 `"local"`（默认）沿用 `createWorkflowExecutionService`，`"remote"` 校验 gateway 存在并构造 `createRemoteWorkflowExecutionService`。
  验证：`npm test -- --run workflow-remote-composition`
  来源：spec `workflow-package` / `Composition Wiring`（MODIFIED）；design 决策 8

- [x] 4.3 为 remote 模式 gateway 缺失添加 negative 测试，断言启动失败（fail-closed）。
  验证：`npm test -- --run workflow-remote-composition-negative`
  来源：spec `workflow-package` / `Remote Mode Without Gateway`；design 决策 8

- [x] 4.4 为模式来源安全性添加 negative 测试，断言请求体、模型输出或 capability 参数中的 mode 字段不覆盖可信 composition 配置。
  验证：`npm test -- --run workflow-remote-mode-source-negative`
  来源：spec `Workflow Execution Mode Selection` / `Mode Source Is Trusted`

## 5. 接口一致性与 Characterization

- [x] 5.1 添加 characterization 测试，使用同一 recipe fixture 和 fake gateway，断言 local 与 remote 模式产出的 `WorkflowExecutionResult.status`、`outputVariables` 关键字段和 `nodeResults` 结构等价；同时断言 remote 模式流式回放的 event 序列与 local 模式产出的 event 序列一致。
  验证：`npm test -- --run workflow-remote-characterization`
  来源：spec `Workflow Execution Mode Selection` / `Local-Remote Interface Consistency`；design 质量属性-可靠性

- [x] 5.2 添加 cancellation characterization 测试，断言 AbortSignal 触发后 SSE 连接被取消且返回 `INTERRUPTED`；AbortSignal 在调用前已触发时不发起远端请求；已回放的 event 仍保留在 runtime timeline 中。
  验证：`npm test -- --run workflow-remote-cancellation`
  来源：spec `Remote Cancellation Propagation`；design 决策 4

## 6. 边界与架构验证

- [x] 6.1 添加 architecture 测试，断言 `agent-workflow` 不直接依赖 fetch/HTTP driver（通过 gateway port 隔离），`agent-platform-gateway-remote` 不依赖 `agent-workflow` 内部实现，跨 package 无 private import。
  验证：`npm run lint:architecture`
  来源：design 决策 2/3；AGENTS.md 架构边界

- [x] 6.2 添加 architecture negative 测试，断言 `RemoteWorkflowExecutionService` 不 import `agent-platform-gateway-remote` 的内部实现（只通过 port 接口）。
  验证：`npm run lint:architecture`
  来源：design 决策 2/3；AGENTS.md 架构边界

## 7. 验证和收尾

- [x] 7.1 运行 OpenSpec 全量校验。
  验证：`openspec validate --all --strict`
  来源：proposal / `归档前更新基线`

- [x] 7.2 运行常规验证门禁。
  验证：`npm run build`；`npm test`；`npm run test:contract`；`npm run lint:architecture`
  来源：AGENTS.md / `验证门禁`

- [x] 7.3 确认实现未引入未使用的 import、变量、helper 或 dead code；确认 local 模式现有测试全部通过无回归。
  验证：`npm run build`；`npm test -- --run workflow`；diff 检查
  来源：AGENTS.md / `实现质量门禁`

## 归档前更新基线检查（非实施任务）

实现完成并验证通过后，在归档前根据 proposal/design 的"归档前更新基线"处理：

- 同步 `openspec/specs/workflow-remote-execution-mode/spec.md`。
- 修改 `openspec/specs/workflow-package/spec.md` 的 Composition Wiring 需求。
- 按需更新 `openspec/overview.md`。
- 新增 `openspec/designs/architecture/workflow-remote-execution-mode.md`。
- 更新 `openspec/designs/modules/agent-workflow.md`、`openspec/designs/modules/agent-platform-gateway-remote.md`、`openspec/designs/modules/agent-app.md`。
- 新增 `openspec/designs/adr/workflow-remote-sse-streaming.md`。
- 更新 `openspec/designs/spec-to-design-map.md`。
- 检查长期文档没有重复定义同一状态机、API schema、数据 owner 或接口语义。
