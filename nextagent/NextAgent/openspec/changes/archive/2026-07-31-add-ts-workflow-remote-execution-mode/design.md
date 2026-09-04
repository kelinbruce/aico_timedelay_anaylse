## 背景和现状（Context）

当前 workflow 执行只有 local 模式。`InMemoryWorkflowExecutionService`（`agent-workflow/src/engine/index.ts`）在本进程内遍历 recipe flow graph，通过 `WorkflowNodeCatalog` 的 handler 逐节点执行，recipe 从 app-composed recipe definition source 解析，recipe 可见性由 RECIPE capability catalog 表达。`agent-core` 的 `DefaultAgent` 通过 `WorkflowExecutionService` 端口（`agent-contracts/core`）调用 `execute(request, signal, observer, runtime)`，不感知执行位置。`agent-app` composition 通过 `workflowExecutionServiceFactory` 或 `createWorkflowExecutionService` 构造服务实例。

现有远端网关参照：`SkillHubRemoteGatewayAdapter`（`agent-platform-gateway-remote`）用 fetch + AbortSignal + safe error mapping 隔离 HTTP driver 细节；gateway contract 如 `RagRetrievalGateway`、`SandboxGatewayPort` 定义在 `agent-contracts/gateway`，均为 async contract。

约束：`agent-app` 是唯一 composition root；跨 package 只能通过 public exports 和 `agent-contracts`/`agent-common` 协作；远端不可信边界必须 safe error mapping；owner scope 和 agent scope 字段只能来自可信 composition。

## 目标和非目标（Goals / Non-Goals）

**目标：**
- workflow 支持 local 和 remote 两种执行模式，默认 local，模式只影响 `WorkflowExecutionService` 实例的构造来源。
- local 和 remote 共享同一 `WorkflowExecutionService` 端口，`agent-core` 消费方代码不变。
- remote 模式通过 gateway 对接远端服务执行 recipe 并返回结果、事件和 pending input。
- 远端失败映射为 SafeError，不泄露敏感信息；cancellation 传播到远端。

**非目标：**
- 不实现远端服务端（远端 recipe registry 归属、服务端 node handler 组装、服务端 HTTP endpoint 留给后续 change）。
- 不新增 Web API、runtime command 或持久化 store。
- 不改变 local 模式的现有行为和默认值。
- 不实现远端服务的认证协议设计（首版复用现有 credential resolver + Bearer token 模式）。

## 设计决策（Decisions）

### 决策 1：模式选择只影响 composition，不影响端口

`WorkflowExecutionMode`（`"local"` | `"remote"`）是 composition-time 配置，不是运行时参数。`agent-app` 在启动时根据可信配置选择构造 `InMemoryWorkflowExecutionService`（local）或 `RemoteWorkflowExecutionService`（remote），注入 `agent-core`。`agent-core` 的 `DefaultAgent` 始终通过 `WorkflowExecutionService` 端口调用，不感知模式。

放弃的备选：在 `WorkflowExecutionRequest` 中增加 mode 字段让 engine 按请求选择——这会让不可信请求体影响执行位置，违反"模式只来自可信 composition"约束，且破坏 agent scope 稳定性。

### 决策 2：gateway port 定义在 `agent-contracts/core`

新增 `WorkflowRemoteExecutionGateway` port 定义在 `agent-contracts/core`，与 `WorkflowExecutionService` 同属 workflow 执行契约族。port 定义放在 core 而非 gateway，因为 AGENTS.md 约束 `agent-contracts/gateway` MUST NOT 依赖 `agent-contracts/core` 等业务 subpath，而本 port 需要携带 `WorkflowExecutionRequest`/`WorkflowExecutionResult`/`WorkflowExecutionEvent` 等 core 契约类型。它是 async contract，签名：

```ts
interface WorkflowRemoteExecutionGateway {
  execute(
    request: WorkflowExecutionRequest,
    signal: AbortSignal
  ): AsyncIterable<WorkflowRemoteExecutionStreamItem>;
}

type WorkflowRemoteExecutionStreamItem =
  | { readonly kind: "event"; readonly event: WorkflowExecutionEvent }
  | { readonly kind: "result"; readonly result: WorkflowExecutionResult }
  | { readonly kind: "failure"; readonly reasonCode: WorkflowRemoteExecutionFailureReasonCode; readonly message: string };
```

`AsyncIterable` 流式产出 `WorkflowRemoteExecutionStreamItem`：`kind: "event"` 携带 `WorkflowExecutionEvent`（按产生顺序流式到达），`kind: "result"` 携带最终 `WorkflowExecutionResult`，`kind: "failure"` 携带远端失败映射。gateway port 只承载传输契约，不持有 request lifecycle、terminal commit 或 timeline ownership——这些留在 `agent-core` 和 `agent-runtime`。

放弃的备选：把 gateway port 放在 `agent-contracts/gateway`——但 gateway subpath MUST NOT 依赖 core 业务 subpath，本 port 需要携带 core 契约类型，放 gateway 会违反边界约束。`RagRetrievalGateway` 能放 gateway 是因为它自定义 request/result 类型只用 common vocabulary，而 workflow remote port 必须复用 core 的 `WorkflowExecutionRequest`/`Result`/`Event` 以满足"同形同策"。

### 决策 3：fetch-based 适配器在 `agent-platform-gateway-remote`

在 `agent-platform-gateway-remote` 新增 `createFetchWorkflowRemoteExecutionGateway` 工厂和 `FetchWorkflowRemoteExecutionGatewayAdapter`，复用 `SkillHubRemoteGatewayAdapter` 的模式：fetch + AbortSignal + credential resolver + safe error mapping。适配器把 HTTP 状态码、网络错误和响应解析失败映射为带 `reasonCode` 的失败结果（`status: "failed"`），不抛 raw error。SSE 解析出的 JSON payload MUST 在 yield 前通过 TypeBox schema 校验（`WorkflowExecutionEventSchema` / `WorkflowExecutionResultSchema`），校验失败映射为 `WORKFLOW_REMOTE_INVALID_RESPONSE`，不 yield 未校验的 payload。

放弃的备选：在 `agent-workflow` 内直接用 fetch——这会让 workflow 包依赖 HTTP driver 细节，违反"gateway 隔离 remote service driver"边界。

### 决策 4：`RemoteWorkflowExecutionService` 在 `agent-workflow`

在 `agent-workflow` 新增 `createRemoteWorkflowExecutionService(options)`，产出实现 `WorkflowExecutionService` 端口的 `RemoteWorkflowExecutionService`。`options` 包含 `gateway: WorkflowRemoteExecutionGateway` 和 `runtimeLogger?: RuntimeLogger`（默认 `noopRuntimeLogger`，与 local engine 同形同策）。它：

1. 把 `execute(request, signal, observer, runtime)` 委托给 `WorkflowRemoteExecutionGateway.execute(request, signal)`，获得 `AsyncIterable<WorkflowRemoteExecutionStreamItem>`。
2. 逐项消费流：`kind: "event"` 项在到达时立即调用 `observer.emitEvent`（若 observer 存在），实现实时回放；`kind: "result"` 项是最终结果；`kind: "failure"` 项映射为 `FAILED` + `SafeError`（`reasonCode` 映射到 `SafeError.code` 和 `safeDetails.reasonCode`，`message` 用安全摘要文本不透传远端原文）。
3. 若 `result.status === "WAITING"` 且 `runtime` 可用，从远端 pending input payload 提取 kind/questions/resumeState，调用 `runtime.requestPendingInput` 注册为本地 pending input，把本地 id 回填到返回结果的 `pendingInput`。
4. 若 `result.status === "WAITING"` 但 `runtime` 不可用，返回 `FAILED` + `WORKFLOW_REMOTE_PENDING_INPUT_RUNTIME_MISSING`。
5. 远端 gateway 返回 `status: "failed"` 时，把 safeError 映射为 `FAILED` 结果。
6. `AbortSignal` 触发时返回 `INTERRUPTED` 结果。

`RemoteWorkflowExecutionService` 不解析 recipe、不执行 node handler、不持有 node catalog——这些都在远端服务。本地只负责传输、event 回放、pending input 桥接和 scope 完整性。

### 决策 5：pending input 桥接复用现有 WAITING/resume 机制

远端服务遇到 interaction node 时返回 `WAITING` + pending input activation（kind、questions、resumeState）。`RemoteWorkflowExecutionService` 调用本地 `runtime.requestPendingInput` 注册 pending input，获得本地 id。调用方（agent-core）处理 pending input 后，以 `resumeState` 再次调用 `execute`，`RemoteWorkflowExecutionService` 透传 `resumeState` 给远端 gateway，远端服务从断点恢复。

这与 local 模式的 WAITING/resume 流程一致：local 模式下 engine 在执行中通过 `runtime.requestPendingInput` 回调注册 pending input；remote 模式下 `RemoteWorkflowExecutionService` 在收到 WAITING 结果后注册。差异只在注册时机（执行中 vs 结果返回后），但端口行为契约一致。

### 决策 6：SSE 流式 event 传输

gateway port 返回 `AsyncIterable<WorkflowRemoteExecutionStreamItem>`，fetch 适配器通过 HTTP SSE（`text/event-stream`）消费远端服务的流式响应。远端服务在执行期间逐个产出 `WorkflowExecutionEvent`（如 LLM 逐字输出的 `NODE_OUTPUT_DELTA`），通过 SSE 实时推送到 fetch 适配器；适配器逐项 yield 到 `RemoteWorkflowExecutionService`，后者在事件到达时立即调用 `observer.emitEvent` 回放到 `agent-core`。

`agent-core` 的 `DefaultAgent` 已经具备实时投影能力：`WorkflowRuntimeEventProjector` 把每个 `WorkflowExecutionEvent` 投影为 `RunTimelineEvent`（如 `LLM_CONTENT_DELTA`、`CAPABILITY_RESULT_DELTA`），通过 `runState.emitEvent` 写入 canonical timeline。timeline 事件由 runtime 持久化，并由 web channel 投影为 SSE stream envelope 供页面呈现。因此 remote 模式下的流式回放使远端执行期间的 streaming delta 实时到达页面，与 local 模式行为一致。

流式传输的终止条件：收到 `kind: "result"` 项（成功/WAITING/INTERRUPTED）或 `kind: "failure"` 项（远端失败）。SSE 连接断开或解析失败映射为 `kind: "failure"` + `WORKFLOW_REMOTE_INVALID_RESPONSE`。

### 决策 7：scope 完整性——远端响应不覆盖本地 scope

`RemoteWorkflowExecutionService` 发送给远端的 `WorkflowExecutionRequest` 携带完整的 owner scope 和 agent scope 字段（来自可信 composition）。远端返回的 `WorkflowExecutionResult` 只消费 `executionId`、`status`、`outputVariables`、`nodeResults`、`pendingInput`、`startedAt`、`completedAt`；不使用远端返回的任何 scope 字段覆盖本地请求中的 scope。

### 决策 8：composition 注入入口

`agent-app` 在 `createComposedApp` 中按 `WorkflowExecutionMode` 直接选择 factory，不修改 `WorkflowExecutionServiceFactoryOptions`：
- 若调用方提供了 `workflowExecutionServiceFactory`，则该 factory 优先，完全覆盖 mode 选择——调用方自行负责构造 local 或 remote 实现。
- 读取配置的 `WorkflowExecutionMode`（默认 `"local"`）。
- `"local"`：沿用现有 `createWorkflowExecutionService`。
- `"remote"`：校验 `workflowRemoteExecutionGateway` 存在，构造 `createRemoteWorkflowExecutionService({ gateway, runtimeLogger })`；若 gateway 缺失则启动失败。

`CreateComposedAppOptions` 新增 `workflowExecutionMode?: WorkflowExecutionMode` 和 `workflowRemoteExecutionGateway?: WorkflowRemoteExecutionGateway` 配置入口。


Gateway selection entry 补充：当 gateway 配置中存在 workflow-execution adapter 且 deploymentMode 为 REMOTE 时，composition 通过 hasWorkflowEndpoint 判断是否使用 HTTP endpoint 构造 fetch-based gateway。若 endpoint 存在则走 createFetchWorkflowRemoteExecutionGatewayFromEndpoint；若 endpoint 缺失（UDS 模式）则回退到注入的 workflowRemoteExecutionGateway，缺失则启动失败。Config validation 不再强制 REMOTE workflow-execution 必须有 endpoint。
放弃的备选：给 `WorkflowExecutionServiceFactoryOptions` 增加 `remoteExecutionGateway` 字段——但 local factory 永远不使用 remote gateway，加了是死字段，违反"不添加未被要求的灵活性"。composition root 直接选择 factory 更简洁。

### 决策 9：remote 执行生命周期日志

`RemoteWorkflowExecutionService` 接收 `runtimeLogger`（与 local engine 同形同策，默认 `noopRuntimeLogger`），在关键生命周期节点记录结构化日志，方便后续问题定位。日志字段 MUST NOT 包含 prompt、raw model output、raw provider error、path、credential 或高基数字段。

日志点：
- `workflow.remote.started`（info）：execute 开始时记录 executionId、recipeName、recipeVersion、hasResumeState。
- `workflow.remote.result`（info）：收到终止项时记录 executionId、status（COMPLETED/WAITING/FAILED/INTERRUPTED）。
- `workflow.remote.failed`（error）：收到 `kind: "failure"` 项时记录 executionId、reasonCode。
- `workflow.remote.aborted`（warn）：AbortSignal 触发时记录 executionId。
- `workflow.remote.pending_input.bridged`（info）：WAITING 桥接成功时记录 executionId、pendingInputKind。
- `workflow.remote.pending_input.missing_runtime`（error）：WAITING 但 runtime 不可用时记录 executionId。

不记录单个 event 的回放——远端 event 数量可能很大，逐条记录会产生噪音且不提供额外诊断价值。不记录 HTTP 传输层细节——fetch 适配器与 `SkillHubRemoteGatewayAdapter` 同形同策，只做 safe error mapping，不内联 logger；传输层失败已通过 reasonCode 区分（UNAVAILABLE/TIMEOUT/UNAUTHORIZED/INVALID_RESPONSE），足以支撑问题定位。

## 质量属性设计（Quality Attributes）

| 质量属性 | 设计结论 | 验证入口 |
|---|---|---|
| 安全 | 远端 gateway 失败映射为 SafeError，不泄露 prompt、raw model output、raw provider error、path、credential；scope 字段只来自可信 composition，远端响应不覆盖；credential 通过 credentialResolver 解析，不内联到日志 | contract test: safe error mapping；negative test: scope 不被远端覆盖、safe error 不含敏感字段 |
| 性能/容量 | SSE 流式传输，远端执行超时由 recipe runtime timeout 和 AbortSignal 控制；event 在产生时实时到达 observer，不增加远端调用次数 | characterization test: local 与 remote 结果等价性；contract test: timeout 映射 |
| 可靠性/恢复 | 远端不可达/超时/未授权/非法响应分别映射为确定性 reasonCode；pending input WAITING/resume 流程与 local 一致，中断后可恢复；AbortSignal 传播保证 cancellation | contract test: 各失败 reasonCode；negative test: WAITING without runtime |
| 可维护性 | gateway port 在 contracts、适配器在 gateway-remote、service 在 workflow、composition 在 app——各层职责单一，跨 package 只通过 public exports | architecture test: 边界隔离、无 private import |
| 可测试性 | gateway port 是 interface，可用 in-memory fake 测试 RemoteWorkflowExecutionService 行为；fetch 适配器可注入 fetch mock | unit test: RemoteWorkflowExecutionService with fake gateway；contract test: gateway port 行为 |
| 审计/可追溯性 | 远端 event 通过 observer 回放进入 runtime timeline（由 agent-core projector 投影），与 local 模式一致；safe error 含 reasonCode 可诊断；`RemoteWorkflowExecutionService` 在关键生命周期节点记录 `workflow.remote.*` 结构化日志 | characterization test: event 回放顺序；observability test: event 不含敏感字段；unit test: 生命周期日志记录 |
| 可诊断性 | `workflow.remote.*` 日志覆盖 execute 开始、终止项、失败映射、abort、pending input 桥接等关键节点；reasonCode 区分四类传输失败；日志不含 prompt、raw model output、path、credential 或高基数字段 | unit test: 日志字段断言；negative test: 日志不含敏感字段 |

## 验证映射（Verification Map）

| 约束 | Task | 验证入口 |
|---|---|---|
| gateway port 类型定义与契约 | 1.1, 1.2 | `npm run build`；`npm run test:contract -- --run workflow-remote-gateway` |
| RemoteWorkflowExecutionService 实现 | 2.1 | `npm run build`；`npm test -- --run workflow-remote-service` |
| 流式 event 实时回放 + 无 observer 不失败 | 2.2 | `npm test -- --run workflow-remote-event-streaming` |
| pending input 桥接 + WAITING without runtime | 2.3 | `npm test -- --run workflow-remote-pending-input` |
| resume 透传与 local 一致 | 2.4 | `npm test -- --run workflow-remote-resume` |
| scope 不被远端覆盖 | 2.5 | `npm test -- --run workflow-remote-scope-integrity` |
| public exports 导出 | 2.6 | `npm run build`；`npm run lint:architecture` |
| remote 生命周期日志记录 | 2.7 | `npm test -- --run workflow-remote-logging` |
| fetch 适配器 safe error + schema 校验 | 3.1, 3.2, 3.3 | `npm test -- --run workflow-remote-fetch-adapter`；`workflow-remote-redaction`；`workflow-remote-schema-validation` |
| composition 优先级 + mode 选择 + gateway 缺失 + mode 来源安全 | 4.1, 4.2, 4.3, 4.4 | `npm test -- --run workflow-remote-composition`；`workflow-remote-composition-priority`；`workflow-remote-composition-negative`；`workflow-remote-mode-source-negative` |
| local/remote 接口等价性 characterization | 5.1 | `npm test -- --run workflow-remote-characterization` |
| AbortSignal 传播 + INTERRUPTED characterization | 5.2 | `npm test -- --run workflow-remote-cancellation` |
| 边界隔离 + 无 private import | 6.1, 6.2 | `npm run lint:architecture` |
| OpenSpec 全量校验 + 常规门禁 + 无 dead code | 7.1, 7.2, 7.3 | `openspec validate --all --strict`；`npm run build`；`npm test`；`npm run test:contract`；`npm run lint:architecture` |
| safe error mapping（unavailable/timeout/unauthorized/invalid） | 3.1 | `npm test -- --run workflow-remote-safe-error` |
| SSE payload schema validation | 3.3 | `npm test -- --run workflow-remote-schema-validation` |
| safe error 不泄露敏感信息 | 3.2 | `npm test -- --run workflow-remote-redaction` |
| 流式 event 实时回放 | 4.1 | `npm test -- --run workflow-remote-event-replay` |
| 无 observer 不失败 | 4.2 | `npm test -- --run workflow-remote-event-replay` |
| AbortSignal 传播 + INTERRUPTED | 5.1 | `npm test -- --run workflow-remote-cancellation` |
| pending input 桥接 + 本地 id 回填 | 6.1 | `npm test -- --run workflow-remote-pending-input` |
| WAITING without runtime → FAILED | 6.2 | `npm test -- --run workflow-remote-pending-input-negative` |
| resume 透传与 local 一致 | 6.3 | `npm test -- --run workflow-remote-resume` |
| scope 不被远端覆盖 | 7.1 | `npm test -- --run workflow-remote-scope-integrity` |
| remote 生命周期日志记录 | 2.7 | `npm test -- --run workflow-remote-logging` |
| fetch 适配器在 gateway-remote | 8.1 | `npm run build`；`npm run lint:architecture` |
| 边界隔离无 private import | 8.2 | `npm run lint:architecture` |
| OpenSpec 全量校验 | 9.1 | `openspec validate --all --strict` |

## 文档承载决策（Documentation Ownership）

- 行为契约：`openspec/specs/workflow-remote-execution-mode/spec.md`（新增）；`openspec/specs/workflow-package/spec.md`（修改 Composition Wiring）。
- 架构和跨模块设计：`openspec/designs/architecture/workflow-remote-execution-mode.md`——跨模块流程、gateway 边界、safe error mapping、observer 回放、pending input 桥接、scope 完整性、质量属性。
- 模块设计：`openspec/designs/modules/agent-workflow.md`（RemoteWorkflowExecutionService 职责）；`openspec/designs/modules/agent-platform-gateway-remote.md`（fetch 适配器职责）；`openspec/designs/modules/agent-app.md`（mode composition wiring）。
- ADR：`openspec/designs/adr/workflow-remote-sse-streaming.md`——SSE 流式 event 传输的设计决策。
- 导航：`openspec/designs/spec-to-design-map.md`。

## 风险与取舍（Risks / Trade-offs）

- [SSE 连接中断] -> 远端执行期间 SSE 连接断开映射为 `WORKFLOW_REMOTE_INVALID_RESPONSE`，已回放的 event 已进入 runtime timeline，不影响持久化和已呈现内容。
- [远端服务端未定义] -> 本 change 只定义客户端（gateway port + adapter + RemoteWorkflowExecutionService）；远端服务端实现和 recipe registry 归属留给后续 change，但客户端契约已固定，服务端只需遵循 `WorkflowRemoteExecutionGateway` 响应契约。
- [远端执行超时] -> 由 recipe runtime timeout 和 AbortSignal 控制；fetch 适配器把超时映射为 `WORKFLOW_REMOTE_TIMEOUT`，不无限等待。
- [pending input 注册时机差异] -> local 在执行中注册，remote 在结果返回后注册；端口行为契约一致，但若远端服务在注册前崩溃，pending input 不会创建——这与 local 模式下 engine 崩溃的语义一致，由 runtime 恢复机制处理。

## 迁移计划（Migration Plan）

无迁移风险。local 模式行为和默认值不变；remote 模式是新增能力，未配置时完全不生效。配置 `WorkflowExecutionMode` 为 `"remote"` 需同时提供 `WorkflowRemoteExecutionGateway` 依赖，否则启动失败（fail-closed）。

## 归档前更新基线（Baseline Promotion Plan）

- `openspec/specs/workflow-remote-execution-mode/spec.md`：新增行为契约。
- `openspec/specs/workflow-package/spec.md`：修改 Composition Wiring 需求。
- `openspec/overview.md`：补充 local/remote 双执行模式产品定位。
- `openspec/designs/architecture/workflow-remote-execution-mode.md`：跨模块流程、gateway 边界、safe error、observer 回放、pending input 桥接、scope 完整性。
- `openspec/designs/modules/agent-workflow.md`：RemoteWorkflowExecutionService 职责。
- `openspec/designs/modules/agent-platform-gateway-remote.md`：fetch 适配器职责。
- `openspec/designs/modules/agent-app.md`：mode composition wiring。
- `openspec/designs/adr/workflow-remote-sse-streaming.md`：SSE 流式 event 传输的设计决策。
- `openspec/designs/spec-to-design-map.md`：导航更新。

## 待确认问题（Open Questions）

无。首版设计已收敛为唯一实现路径：gateway port 在 contracts/core、fetch 适配器在 gateway-remote、RemoteWorkflowExecutionService 在 agent-workflow、composition 在 agent-app，SSE 流式 event 传输，pending input 桥接复用 WAITING/resume。远端服务端实现明确留给后续 change。

## 长期基线刷新计划

本节将旧模板的“归档前更新基线”归一为可审计的归档门禁；以下均为**归档前待执行**，不表示 stable baseline 已刷新。

- **Function：**以 `FN-9.1-执行工作流` 为唯一用户可见行为 owner；若本 change 增加的行为不能被该 Function 的既有边界完整表达，先在同一能力域新增一个单一职责 Function，再更新 `openspec/designs/functions/index.md`，不得把实现细节直接写入 Function。
- **Stable spec：**将 delta Requirement 合并至 `openspec/specs/workflow-package/spec.md`、`openspec/specs/workflow-remote-execution-mode/spec.md`，逐条核对 Requirement 标题、MUST/SHALL 语义、场景、迁移和 metadata；不得以 `--skip-specs` 绕过同名 Requirement 重叠。
- **长期设计：**先执行本 design/proposal 已列出的“归档前更新基线”设计 owner；再在 `openspec/designs/spec-to-design-map.md` 为上述 stable spec 写入该 Function、实际承载的 architecture/module/ADR 与验证入口。若现有 map 无该 spec 行，先创建该行，而非把 change-local design 当作长期设计。
- **归档判定：**Function、stable spec、长期设计和 map 四端均完成 diff 审阅且 `openspec validate --all --strict` 通过后，才允许归档；任一端无法唯一归属时保留 active 并标记阻塞。
