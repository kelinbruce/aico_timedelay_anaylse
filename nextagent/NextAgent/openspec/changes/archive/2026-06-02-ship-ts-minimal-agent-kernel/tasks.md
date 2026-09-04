## 1. 前置契约、范围和测试基线

- [x] T001 核对并同步 `agent-common` 和 `agent-contracts` public exports，确保本 change 需要的 runtime、channel、session、context、model、capability、gateway、observability 和 app contract 已在 owning public export 中定义；同步 `packages/agent-contracts` 源码，使其覆盖本 change 依赖的 `SubmitRequestCommand`、`RequestAccepted`、`RequestRun` / `RequestRunRecord` / gateway write options、`TerminalCommitRequest`、`RuntimeEventStreamQuery`、`ContextAssemblyRequest`、`RenderedModelInput`、`ModelInvocationRequest` / `ModelProviderKind` / `ModelProfile`、`CapabilityDescriptor` / `CapabilityInvocationRequest`、`SessionHistoryRecordQuery`、`SessionHistoryPage/Entry`、`ListSessionMessagesRecordQuery`、`SessionMessageRecordPage`、`ListCurrentRequestMessagesRecordQuery` 等契约形态；落实本 change 对 `ts-core-contracts` 的 session history/message refinement。发现其他缺口时只通过核心契约范围修正，不在实现包中重定义 DTO。
  验证：`npm run test:contract`；code review 检查所有跨模块 import 来自 owning public export，并断言 model/app/runtime/context/capability/gateway/session contract 与本 change 和 `openspec/designs/contracts/core-contracts.md` 一致，`ContextAssemblyRequest` 使用 `requestId` 而不是 `rootMessageId`，session history/conversation contract 使用内部字段和 before-cursor 语义。
  来源：Requirement: 最小问答主流程；design.md 决策 1。

- [x] T002 建立范围边界 review 清单，逐项标记 `real`、`minimal`、`noop` 和 `deferred` 能力，并把清单作为后续模块 code review 输入。
  验证：code review 检查清单覆盖 `scope-boundaries.md` 四类范围级别；该项无法完全自动化，因为它比较实现意图和范围边界。
  来源：Requirement: Scope Boundary For In-scope And Deferred Behavior。

- [x] T003 添加核心 contract characterization tests，断言 `RequestContext` 不含 `attempt`、`deadlineAt`、`messageRefs`，且 `ToolCallState.arguments` 是结构化 JSON。
  验证：`npm run test:contract`。
  来源：Requirement: RequestContext 使用可恢复执行坐标。

## 2. Runtime Acceptance、Session 和 Assembly Binding

- [x] T004 实现 `POST /api/v1/sessions` 显式创建 owner-scoped 空 session，并在 convenience submit payload 无 `sessionId` 时委托 `agent-session` 创建 owner-scoped session，均初始化可追加的 active context state。
  验证：Web submit/session characterization test 覆盖 explicit create-session、convenience create-session 和 active context state initialization，断言 create-session 不触发 runtime/model，public request body 不允许 `idempotencyKey`，channel 生成 server-side idempotency key 后再写 session；无 `sessionId` 的 convenience submit 重复同一 submit key 不泄漏额外空 session；response 只包含 `sessionId/displayTitle/lastActivityAt`，且不含 `streamPath`、`websocketPath`、conversation、request accepted fields、cursor 或 sequence。
  来源：Requirement: 最小问答主流程；Requirement: Web Submit Stream And History。

- [x] T005 实现 Web submit payload 携带 `sessionId` 时的 owner-scoped session lookup，合法 session 用于构造 runtime submit command。
  验证：Web submit/session characterization test 覆盖 use-existing-session。
  来源：Requirement: 最小问答主流程。

- [x] T006 添加跨 owner、缺失或不可用 session 的 submit negative test，断言返回 safe not-found outcome，不暴露 session 是否存在或属于其他 owner。
  验证：`npm test -- --run agent-runtime` 中 cross-owner/missing-session rejection tests。
  来源：Requirement: 最小问答主流程；Requirement: Owner Scope And No-op Boundaries。

- [x] T007 在 acceptance 阶段调用 `AgentAssemblyRegistry.active(agentId)`，并把 resolved `agentId`、`agentVersion`、`agentAssemblyRef` 固化到 `RequestRun`。
  验证：assembly binding characterization test 断言 persisted `RequestRun` 包含 accepted assembly identity。
  来源：Requirement: Runtime 接受请求并固化 Agent Assembly。

- [x] T008 构造 `RequestContext`，只写入恢复坐标、identity、locale、assembly refs、lifecycle stage、tool batch state 和 flow variables。
  验证：`npm run test:contract`；runtime unit test 断言构造出的 context 不含禁止字段。
  来源：Requirement: RequestContext 使用可恢复执行坐标。

- [x] T009 实现 acceptance 后固定 assembly 读取：core、context 和 capability routing 使用 `AgentAssemblyRegistry.require(agentId, agentVersion)`。
  验证：测试在 request accepted 后切换 active assembly，断言执行仍使用 accepted version。
  来源：Requirement: Runtime 接受请求并固化 Agent Assembly。

- [x] T010 使用核心契约中带 `sessionId` 的 `RuntimeCommandPort.submit` command 和 `RequestRunRecord + idempotencyKey write option` 持久化 accepted `RequestRun`，并返回 `RequestAccepted(sessionId/requestId/runId/attempt)`，不返回 stream cursor 或 timeline sequence。
  验证：runtime submit contract test 断言 submit command 需要 `sessionId`、write request 携带 `idempotencyKey`，且 accepted response 字段全集。
  来源：Requirement: Web Submit Stream And History。

## 3. Session Message、Active Context 和 Timeline

- [x] T011 保存 root user `SessionMessage`，并携带 owner scope、sessionId、requestId、runId 和 visible history 所需字段。
  验证：session gateway contract test 覆盖 user message save/list visible messages。
  来源：Requirement: 最小问答主流程；Requirement: Web Submit Stream And History。

- [x] T012 将 root user message 通过 gateway composite write 持久化并追加到 active context view；standalone active context append primitive 仍使用 `expectedActiveContextVersion` 防止覆盖已变化的 view。
  验证：message append composite transaction source assertion 覆盖 runtime 主路径不拆分 message/active-context 写入；active context append test 覆盖 standalone success 和 version conflict。
  来源：Requirement: Context 和 Model 调用边界。

- [x] T013 实现 assistant tool-use message composite append，一次 gateway 写入同时持久化 message 并追加 active context item。
  验证：tool loop integration test 断言 assistant tool-use message 和 active context item 均存在，architecture/source assertion 断言 runtime-owned message append port 调用 gateway composite write。
  来源：Requirement: 最小 Capability Read Tool。

- [x] T014 实现 capability result message composite append，一次 gateway 写入同时持久化 message 并追加 active context item。
  验证：tool loop integration test 断言 capability result message 和 active context item 均存在，architecture/source assertion 断言 runtime-owned message append port 调用 gateway composite write。
  来源：Requirement: 最小 Capability Read Tool。

- [x] T015 实现 terminal commit composite write，一次 gateway transaction 同时持久化 terminal run state、terminal assistant message、active context item 和 terminal timeline event。
  验证：terminal active context test 断言成功 terminal commit 只追加一次 terminal assistant message，architecture/source assertion 断言 terminal commit gateway composite write 使用单个 SQLite transaction。
  来源：Requirement: Terminal Consistency And Safe Error。

- [x] T016 实现 `listCurrentRequestMessages(ListCurrentRequestMessagesRecordQuery)` 和领域映射，查询必须携带 tenantId、subjectId、sessionId、requestId、runId、includeHidden、offset 和 limit。
  验证：gateway/session contract test 断言合法查询返回当前 request/run messages。
  来源：Requirement: RequestContext 使用可恢复执行坐标。

- [x] T017 添加 current request message query negative tests，断言缺少 owner scope、缺少 runId 或只按 requestId 查询会失败。
  验证：gateway/session negative contract tests。
  来源：Requirement: RequestContext 使用可恢复执行坐标；Requirement: Minimal Kernel Verification。

- [x] T018 实现 runtime-owned `RunTimelineEventPort` wrapper，canonical 化事件字段并覆盖 runtime-owned fields。
  验证：timeline contract test 断言 runtime-owned fields 被覆盖，且 requestId 对应根用户消息。
  来源：Requirement: Agent Core 通过目标执行边界；Requirement: Web Submit Stream And History。

- [x] T019 实现 session-scoped timeline sequence 分配和带 `idempotencyKey` 的 timeline store append。
  验证：timeline contract test 断言 append request 携带 `idempotencyKey`，sequence 在 session 内从 1 开始单调递增。
  来源：Requirement: Web Submit Stream And History。

## 4. Agent Core、Context Engine 和 Model Boundary

- [x] T020 实现 Runtime single-run dispatcher/scheduler：只调度已持久化、assembly 已固化且未进入 terminal 的 accepted run；启动前使用 `RequestRunRecord + { expectedVersion }` 将同一 run 从 `status=ACCEPTED` CAS 推进到 `status=EXECUTING`；CAS 成功后调用 `Agent.execute(run, context, timeline, messages, signal)`，CAS 未更新时不得调用 Agent。
  验证：runtime scheduling unit test 断言 Agent.execute 调用参数、runtime-owned timeline wrapper、runtime-owned message append port、signal ownership、missing assembly 不调度、terminal run 不调度、CAS 冲突时同一 run 不重复启动，且不产生 queued run/FIFO lane/replacement/terminal-pending dispatch behavior。
  来源：Requirement: Agent Core 通过目标执行边界。

- [x] T021 实现 `Agent.execute` 的 direct answer path，至少完成一次 context render 和 model invocation。
  验证：agent-core unit test 使用 deterministic model stream，断言 Agent resolve。
  来源：Requirement: Agent Core 通过目标执行边界；Requirement: 最小问答主流程。

- [x] T022 实现 Agent 通过 timeline 发布 final agent message fact，且不发布 runtime terminal lifecycle event。
  验证：agent-core contract test 断言 final fact 经 `RunTimelineEventPort.emit` 发布，且无 `REQUEST_COMPLETED/FAILED/CANCELED/SUPERSEDED`。
  来源：Requirement: Agent Core 通过目标执行边界。

- [x] T023 实现 Context Engine assemble：`ContextAssemblyRequest` 只接受 `sessionId`、`requestId`、`requestContextId`、`agentId`、`agentVersion`、`runId`、`stepId`、`locale`、`purpose`，再从 active context view、当前 request user message、必要历史、locale、owner metadata 和 assembly refs 生成 `ContextAssembly`；当前 root user message id 使用核心契约已有的 `requestId`，不得新增 `rootMessageId` 同义字段。
  验证：context-engine tests 断言 selected messages 来自 active context view，不扫描全量 session history；negative contract test 断言 `ContextAssemblyRequest` 不携带 `rootMessageId`、`historyRefs`、`attachmentRefs`、`capabilityDisclosureRefs`、`currentMessage`、`agentAssembly` 或 `budget`。
  来源：Requirement: Context 和 Model 调用边界。

- [x] T024 实现 Context Engine render：将 `ContextAssembly` 渲染为包含默认 prompt/profile、system/user/history/enabled capability tool schema、locale/language hint 和电信术语原文保留约束的 `RenderedModelInput`，并应用真实最小 window/budget guard。
  验证：context-engine render tests 断言 rendered messages、read tool metadata、locale/language hint、telecom term preservation instruction、默认 prompt/profile 和 window/budget guard；`RenderedModelInput` 不包含完整 `ContextAssembly`；超出硬上限时不得静默截断模型可见内容。
  来源：Requirement: Context 和 Model 调用边界；Requirement: 最小 Capability Read Tool。

- [x] T025 实现 core 将 `RenderedModelInput` 扁平化为 `ModelInvocationRequest`，包含 requestId、stepId、providerKind、modelName、baseUrl、credentialRef、ChatMessage、tools、temperature、maxTokens、topP、thinking、providerOptions、timeoutMs。
  验证：model boundary contract test 捕获 request，断言字段全集。
  来源：Requirement: Context 和 Model 调用边界。

- [x] T026 添加 model boundary negative test，断言 `ModelInvocationRequest` 不包含 `ContextAssembly`、`RenderedModelInput`、provider SDK、AI SDK 或 runtime streaming context。
  验证：model boundary negative contract test。
  来源：Requirement: Context 和 Model 调用边界；Requirement: Minimal Kernel Verification。

- [x] T027 实现 `ModelInvocationService.complete(request, signal)` async contract。
  验证：model contract test 覆盖 complete，断言 request 中无 mode 字段。
  来源：Requirement: Context 和 Model 调用边界。

- [x] T028 实现 `ModelInvocationService.stream(request, signal)` async iterable contract。
  验证：model contract test 覆盖 stream，断言 request 中无 mode 字段。
  来源：Requirement: Context 和 Model 调用边界。

- [x] T029 实现固定 OpenAI 真实 model provider adapter，支持共享 model profile 中的 `providerKind=OPENAI`、model name、base URL、credential reference、timeoutMs、model options 和 provider options。
  验证：provider adapter test 使用本地 fake HTTP server 验证 OpenAI adapter request 构造，测试对象必须是 OpenAI adapter 本身而不是 fake provider；断言 OpenAI-specific env 已在 app/config adapter 映射为共享 profile 字段。
  来源：Requirement: 最小真实 Model Provider。

- [x] T030 添加 app composition smoke，断言产品路径使用真实 OpenAI provider factory，test provider 只能通过 test composition 显式注入，产品配置不能选择 deterministic/test provider。
  验证：app composition smoke test；product config negative test。
  来源：Requirement: 最小问答主流程；Requirement: 最小真实 Model Provider。

- [x] T031 实现 OpenAI model stream normalization，覆盖 content delta、可选 thinking delta、multi-chunk tool-use arguments、final result 和不伪造 thinking 的 provider 不支持场景。
  验证：model stream tests 覆盖按 stable `toolCallId` 聚合多块 JSON 参数、非法 JSON safe failure、OpenAI 不支持 thinking 时不产生 `LLM_THINKING_DELTA`。
  来源：Requirement: 最小真实 Model Provider。

- [x] T032 实现 provider safe error mapping，禁止 raw provider error、credential、request body 或 response body 出现在 SafeError、日志、stream。
  验证：safe provider error negative test；safe-data tests。
  来源：Requirement: Terminal Consistency And Safe Error；Requirement: 最小真实 Model Provider。

## 5. Capability Read Tool 和 Tool Loop

- [x] T033 实现 capability catalog descriptor resolution 和 `CapabilityInvocationPort` 调用切片，并暴露 read capability descriptor；`CapabilityInvocationRequest` 字段固定为 `invocationId`、`capabilityId`、`toolCallId?`、`arguments`、`sessionId`、`requestId`、`runId`、`requestContextId`、`stepId`、`identityContext`、`agentId`、`agentVersion`、`timeoutMs`、`idempotencyKey?`。
  验证：capability catalog test 断言 read descriptor 可见且产品路径只暴露最小内核允许的 read；Agent core 可按 capability id/name 解析 enabled descriptor，未启用 capability 不进入模型可见 tools；capability invocation contract test 断言 request 字段全集且不包含 `workspaceDir` 或 `recoveryReplay`。
  来源：Requirement: 最小 Capability Read Tool；Requirement: Scope Boundary For In-scope And Deferred Behavior。

- [x] T034 将 read capability schema 披露到 model tool metadata。
  验证：context render test 断言 read tool schema 可见，且模型可见参数名固定为必填 `file_path`、可选 `offset`、可选 `limit`，不包含 `path`、`filePath` 或其它 alias。
  来源：Requirement: 最小 Capability Read Tool。

- [x] T035 实现 read capability invocation 的 `file_path` workspace-relative path resolution、offset、limit、最大输出大小和 structured success payload。
  验证：read tool unit tests 覆盖 `file_path` 相对路径、line-based `offset`、line-based `limit`、默认 `offset=0`、默认 `limit=2000`、bounded slice、`content`、`truncated=true` 和 `nextOffset`，断言 success payload 固定包含 `file_path`、`offset`、`limit`、`content`、`truncated` 和可选 `nextOffset`，且返回的 `file_path` 为 normalized workspace-relative path、不暴露宿主机绝对路径，并断言不接受 `path`/`filePath` alias、负数 offset、非整数 offset/limit、`limit < 1` 或 `limit > 2000`。
  来源：Requirement: 最小 Capability Read Tool；`core-context-model-capability.md` Read Capability。

- [x] T036 添加 read capability negative tests：绝对路径、路径逃逸、目录读取、glob pattern、权限/安全拒绝、timeout/abort 必须 safe failure 且导致 request failed；缺失文件和普通 IO failure 可作为 safe tool result 继续模型；所有 failure 不泄漏未脱敏宿主路径。
  验证：read tool negative tests；safe-data assertions；tool loop failure integration tests。
  来源：Requirement: 最小 Capability Read Tool；Requirement: Terminal Consistency And Safe Error。

- [x] T037 实现 model -> enabled capability invocation -> follow-up model 的最小 tool loop；Agent core 按通用 capability descriptor 解析并通过 `CapabilityInvocationPort` 调用，当前产品只启用 read，支持同一模型响应中多个 read tool calls 按出现顺序串行执行。
  验证：integration test 使用 deterministic model 先返回一个或多个 read tool calls、再基于 tool results 返回 final answer；negative test 断言未启用/不可解析 capability 不被 core hardcode 执行，而是发布 `DEGRADATION_NOTICE` 并 `REQUEST_FAILED`。
  来源：Requirement: 最小问答主流程；Requirement: 最小 Capability Read Tool。

- [x] T038 添加 current-run tool state reconstruction characterization test，断言同一次 request 主流程中 tool batch state 可从 assistant tool-use message、capability result message 和 `ToolCallState` 重建，且不依赖重新解析模型原始输出；不实现 process restart recovery、checkpoint lookup、`claimRun`/`listRecoverableRuns` 调度、tool replay 或多实例 takeover。
  验证：current request message/tool state reconstruction test；deferred recovery negative assertions。
  来源：Requirement: RequestContext 使用可恢复执行坐标；`core-context-model-capability.md` Tool Loop State。

## 6. Terminal Commit、Failure 和 History Consistency

- [x] T039 实现 terminal commit coordinator：读取 Agent final agent message fact，并构造 terminal assistant message 或 safe failure message。
  验证：terminal commit unit test 覆盖 final fact success 和缺失 final fact failure path。
  来源：Requirement: Terminal Consistency And Safe Error。

- [x] T040 实现 terminal commit `PENDING -> COMMITTED` flow：durable terminal commit 前用 `RequestRunRecord + { expectedVersion }` 将 `RequestRun.terminalCommitState` 置为 `PENDING`，再通过 terminal commit CAS/idempotency 写入 terminal message、terminal event 和 `RequestRun` terminal state，并在成功后进入 `terminalCommitState=COMMITTED`。
  验证：terminal commit idempotency test 断言 PENDING->COMMITTED 状态推进、重复 commit 不产生第二个 visible terminal message。
  来源：Requirement: Terminal Consistency And Safe Error。

- [x] T041 确保 channel-visible terminal stream event 只在 durable terminal commit 成功并进入 `terminalCommitState=COMMITTED` 后发布；terminal durable commit failure 不得发布 `REQUEST_COMPLETED` 或 `REQUEST_FAILED`，已进入 `PENDING` 时必须尝试更新为内部可诊断 `FAILED`，该诊断更新也失败时保留 `PENDING`。
  验证：stream-terminal consistency test 断言 terminal event 不早于 durable terminal fact；terminal commit failure test 断言无 completed/failed final stream event，且 run 处于 `FAILED` 或诊断更新失败后的 `PENDING` internal commit state。
  来源：Requirement: Terminal Consistency And Safe Error；`runtime-channel-session.md` Terminal Commit。

- [x] T042 实现 Agent reject、model error、capability error 和 gateway conflict 的 runtime failure normalization。
  验证：runtime failure characterization tests 覆盖四类失败。
  来源：Requirement: Terminal Consistency And Safe Error。

- [x] T043 添加 stream terminal、history 与 active context 一致性集成测试。
  验证：integration test 先消费 terminal SSE event，再读取 history 和 active context，断言 visible assistant message、terminal outcome 和模型可见 terminal message ref 一致。
  来源：Requirement: Terminal Consistency And Safe Error。

## 7. Web Channel、SSE 和 History

- [x] T044 实现 Web submit routes：session-scoped `POST /api/v1/sessions/{sessionId}/requests` 和 TS convenience `POST /api/v1/requests`，包含 runtime schema validation、可信 identity 注入、owner-scoped session preparation 和 RuntimeCommandPort 调用；submit body 要求 non-blank `inputText` 和 `idempotencyKey`，可携带 `locale?` 和 `attachments?: []`，convenience submit 可额外携带 `sessionId?`；public `attachments?: []` 只在 channel DTO 层存在，并映射为核心 `attachmentIds=[]`。
  验证：Fastify inject Web contract test 断言非法 schema 被拒绝、identity 来自 auth/channel boundary、无 sessionId payload 会先创建 session，必填 `inputText`/`idempotencyKey` 生效，且传给 runtime 的 `attachmentIds` 为空数组、不会传递 `attachments` 字段。
  来源：Requirement: Web Submit Stream And History；Requirement: Owner Scope And No-op Boundaries。

- [x] T045 实现 Web submit accepted response 投影，并断言两条 submit route 传入 RuntimeCommandPort 的 command 都携带核心契约必填的 `sessionId`，response 只返回 `sessionId/requestId/runId/attempt`。
  验证：Fastify inject Web contract test 断言 RuntimeCommandPort 收到 `sessionId`，两条 submit route DTO 完全一致，response 不含 `streamPath`、`createdSession`、cursor、`acceptedSequence` 或 sequence。
  来源：Requirement: Web Submit Stream And History。

- [x] T046 实现 SSE stream route，解析 `lastSeenSequence`，提交后默认使用 `0`。
  验证：SSE route test 断言默认 lastSeenSequence 为 0。
  来源：Requirement: Web Submit Stream And History。

- [x] T047 让 SSE stream route 调用 `RuntimeEventStreamPort.stream({ sessionId, lastSeenSequence })`，可选 requestId/runId 只作为过滤条件。
  验证：SSE route test 断言 RuntimeEventStreamPort 收到 sessionId、lastSeenSequence 和 filter。
  来源：Requirement: Web Submit Stream And History。

- [x] T048 实现 canonical timeline 到 `StreamEnvelope` 的投影表，事件名必须与 shared canonical `StreamEventType` vocabulary 一致。
  验证：stream projection contract tests 覆盖 `REQUEST_ACCEPTED`、`LLM_THINKING_DELTA`、`LLM_CONTENT_DELTA`、`CAPABILITY_STARTED`、`CAPABILITY_RESULT_DELTA`、`CAPABILITY_COMPLETED`、`REQUEST_COMPLETED`、`REQUEST_FAILED` 和 `DEGRADATION_NOTICE`。
  来源：Requirement: Web Submit Stream And History。

- [x] T049 添加 timeline-only event filter tests，断言首版不对话可见的 timeline-only events 不投影给普通对话流。
  验证：stream projection negative tests。
  来源：Requirement: Web Submit Stream And History；Requirement: Scope Boundary For In-scope And Deferred Behavior。

- [x] T050 实现 history session list route：public query 只允许 `offset?` 和 `limit?`；channel-facing query 经 `agent-session` 映射为带 `tenantId`、`subjectId`、`offset`、`limit` 的 `SessionHistoryRecordQuery` 后调用 `SessionStoreGateway.listSessions(...)`，结果按 `updatedAt desc, sessionId asc` 稳定排序；gateway/session contract 只返回 internal `sessionId/title?/updatedAt`，response 为 `entries/offset/limit/hasMore`，entry 只包含 `sessionId/displayTitle/lastActivityAt`，并由 channel 将内部 `title?`/`updatedAt` 投影。
  验证：Web history contract test 断言 owner scope、分页和稳定排序传入或应用，gateway/session contract 不接收 `includeSuperseded`，不接收或返回 public `displayTitle`/`lastActivityAt` alias，也不返回 `lastMessagePreview`、`lastRequestStatus` 或 `hasInFlightRequest`；response 不含 owner、`includeSuperseded`、cursor、`title`、`updatedAt`、`lastMessagePreview`、`lastRunStatus`、`hasInFlightRequest`、stream/ws path 或 conversation。
  来源：Requirement: Web Submit Stream And History。

- [x] T051 实现 conversation history route：默认返回最近 visible message window，response items 按 `createdAt asc, messageId asc` 输出，使用 public `cursor`/`nextCursor` 加载更早记录；channel-facing query 映射为带 `tenantId`、`subjectId`、`sessionId`、可选 `requestId`、可选 `locale`、固定 `includeHidden=false`、`includeCapabilityResults`、内部 `beforeCursor?` 和 `limit` 的 `ListSessionMessagesRecordQuery`，并将内部 `nextBeforeCursor?` 投影为 public `nextCursor`。
  验证：Web conversation history contract test 断言默认 recent window、response 正序、channel 将 public `cursor`/`nextCursor` 映射到/来自内部 `beforeCursor`/`nextBeforeCursor`，gateway/session contract 不接收或返回 public cursor alias 且不使用 offset 分页，includeHidden 不暴露且固定 false、includeCapabilityResults 默认 false 且显式 true 可返回 visible capability result。
  来源：Requirement: Web Submit Stream And History。

## 8. Owner Scope、No-op 和 Observability

- [x] T052 实现 owner scope 贯穿 submit、stream、history、session/message/run/timeline/capability/audit gateway requests。
  验证：owner scope smoke tests 覆盖合法访问；negative tests 断言 runtime stream 和 context assembly/render 在无法从可信 submit/session-bound identity 或 accepted request context 解析 owner scope 时必须 fail closed，不得用 sessionId、requestId、默认本地 identity 或其它派生值构造 tenantId/subjectId 继续访问 gateway。
  来源：Requirement: Owner Scope And No-op Boundaries。

- [x] T053 添加跨 owner negative tests：请求体或 metadata 中 owner 字段不得覆盖可信 identity，跨 owner session/message/run/timeline/history 访问必须返回 safe not-found outcome。
  验证：owner scope negative tests。
  来源：Requirement: Owner Scope And No-op Boundaries。

- [x] T054 装配 lifecycle hook no-op provider，并在 request accept、before model、before capability、before terminal 调用；no-op 必须是显式产品 composition provider，不是缺失依赖或 test-only stub；只能返回 continue/no-op，不得影响 request 决策。
  验证：no-op hook smoke test 使用 spy 断言四类调用点，composition smoke 断言产品默认装配显式 no-op provider，并断言 no-op 不改变 model profile、tools、context、terminal state、degradation strategy 或 security decision。
  来源：Requirement: Owner Scope And No-op Boundaries；`app-gateway-observability.md` No-op Boundaries。

- [x] T055 装配 checkpoint no-op provider，并在 run accepted/execution start、before model、before capability、before terminal commit 调用 `saveCheckpoint`；no-op 必须是显式产品 composition provider，不是缺失依赖或 test-only stub；产品 no-op 不写 checkpoint record、不支持 lookup/recovery。
  验证：no-op checkpoint smoke test 使用 spy 断言调用点和 safe payload，composition smoke 断言产品默认装配显式 no-op provider，并断言产品 no-op 无持久化副作用。
  来源：Requirement: Owner Scope And No-op Boundaries。

- [x] T056 装配 audit no-op writer，并在 request accepted、capability completed/failed、terminal committed/failed、security rejection 调用；no-op 必须是显式产品 composition provider，不是缺失依赖或 test-only stub；产品 no-op 不落库、不保留 ring buffer、不暴露 debug read interface。
  验证：no-op audit smoke test 使用 spy/sink 断言 safe summary 和低敏 attributes，composition smoke 断言产品默认装配显式 no-op provider。
  来源：Requirement: Owner Scope And No-op Boundaries。

- [x] T057 实现 ErrorNormalizer 和 safe logging 约束，禁止 raw prompt、model output、stream delta、tool args/result、raw provider error、credential、token、附件内容、未脱敏路径进入对外 payload 或日志。
  验证：safe-data tests；secret scan；log assertion tests。
  来源：Requirement: Terminal Consistency And Safe Error；`app-gateway-observability.md` Safe Error 和日志。

## 9. Architecture Boundary、端到端验收和收尾

- [x] T058 添加 dependency-cruiser architecture rule 和 negative fixtures，断言 `agent-contracts` 不依赖 Fastify、Kysely/SQLite、provider SDK、implementation packages，implementation packages 不使用 private path import。
  验证：`npm run lint:architecture` 实际触发 private path import、provider SDK leakage 和 forbidden dependency negative fixtures 失败并断言。
  来源：Requirement: Minimal Kernel Verification；design.md 质量属性“可维护性”。

- [x] T059 添加 deferred boundary tests 或 architecture assertions，证明附件、memory、多工具/多 capability source、Skill source、WebSocket、完整 cancel/retry/edit、多实例 recovery、terminal recovery、远端 Agent 和 output continuation 没有进入最小内核产品路径。
  验证：architecture tests、route registry tests、capability catalog tests；Web submit schema negative test 断言附件输入被拒绝或无法绑定；capability negative test 断言非 read capability 未暴露且不可执行；output guard tests 断言超限不触发自动续写。
  来源：Requirement: Scope Boundary For In-scope And Deferred Behavior；proposal 非目标。

- [x] T060 执行范围边界 review，确认范围内 `real`/`minimal` 能力均满足本 change 对应的 spec、interface matrix 和任务验证项，且 deferred 能力没有被隐式迁入。
  验证：code review 检查点：T002 清单全部关闭；无法完全自动化，因为它比较模块实现和范围边界。
  来源：Requirement: Scope Boundary For In-scope And Deferred Behavior。

- [x] T061 添加最小端到端问答发布验收：使用产品 composition、OpenAI adapter 和真实 OpenAI endpoint 完成 Web submit、SSE content、terminal event、history final assistant message；deterministic/test provider 不能满足该验收。
  验证：product-path OpenAI E2E minimal QA test；`npm run test:e2e:openai`。
  来源：Requirement: 最小问答主流程。

- [x] T062 添加最小 read tool 端到端测试：模型请求 read，capability 返回文件片段，模型最终回答，stream/history 一致。
  验证：E2E/integration read tool loop test；`npm test`。
  来源：Requirement: 最小问答主流程；Requirement: 最小 Capability Read Tool。

- [x] T063 添加轻量 bilingual/telecom term render 验收：中文输入中包含英文电信术语时，rendered model input 保留该术语并携带语言/术语保留指令。
  验证：context render contract test。
  来源：Requirement: Context 和 Model 调用边界。

- [x] T064 添加输出超限不得静默截断测试，覆盖 model delta、capability result message 和 terminal assistant message 的大小/长度 guard；read capability line-based bounded slice 只通过 `truncated=true`/`nextOffset` 表达正常切片。
  验证：output guard tests 断言除 read bounded slice 外，硬上限命中会发布 `DEGRADATION_NOTICE` 并以 safe `REQUEST_FAILED` 结束，且无 raw prompt/model/tool/path 泄漏。
  来源：Requirement: Terminal Consistency And Safe Error。

- [x] T065 添加并发正确性 smoke：同一 session 已有 active run 时，并发 submit 返回 safe conflict/rejection，不创建 queued run、不进入 FIFO lane；跨 session 并发 submit 不串 session/request/run/timeline/history 标识。
  验证：runtime/session concurrency smoke tests 断言同 session 同一时刻最多一个 active run、active-run conflict safe rejection、无 queued run/fifo lane 事实，以及跨 session 标识隔离。
  来源：Requirement: 最小问答主流程。

- [x] T066 添加 Web route registry tests，断言已确认最小 route table 和 `POST /api/v1/requests` 存在，且 `GET /api/v1/sessions/{sessionId}`、WebSocket、user-input、cancel、retry、edit、attachment upload/download、title、feedback 和独立 session detail 能力不作为本 change 产品行为暴露。
  验证：Fastify route registry tests。
  来源：Requirement: Web Submit Stream And History；Requirement: Scope Boundary For In-scope And Deferred Behavior。

- [x] T067 添加 submit attachment schema tests，断言空 `attachments?: []` 合法且只在 channel DTO 层被接受，并映射为核心 `attachmentIds=[]`；`attachmentIds` 字段、非空 `attachments`、附件对象、upload ref 或附件 metadata 必须 schema validation failed。
  验证：Fastify inject submit schema negative tests。
  来源：Requirement: Web Submit Stream And History；Requirement: Scope Boundary For In-scope And Deferred Behavior。

- [x] T068 添加 OpenAI provider credential boundary tests，断言 `ModelInvocationRequest` 只携带 `credentialRef`，provider adapter 通过安全 resolver 解析 raw credential，raw key 不进入 logs、stream、history、safe error、audit、timeline 或 gateway record。
  验证：provider credential boundary tests；safe-data assertions。
  来源：Requirement: 最小真实 Model Provider；Requirement: Terminal Consistency And Safe Error。

- [x] T069 添加 tool loop limit tests，断言同一模型响应多个 read calls 按顺序串行执行，未启用/不可解析 capability safe rejected，`maxToolRounds=3` 或 `maxToolCallsPerRound=5` 命中时不执行部分集合后继续，而是发布 `DEGRADATION_NOTICE` 并 `REQUEST_FAILED`。
  验证：agent-core/tool-loop integration tests。
  来源：Requirement: 最小 Capability Read Tool；Requirement: Terminal Consistency And Safe Error。

- [x] T070 添加 failure classification tests，断言 model timeout 和 read timeout/abort 产生 `DEGRADATION_NOTICE` 后 `REQUEST_FAILED`；read 路径安全拒绝直接失败；缺失文件和普通 IO failure 可作为 safe tool result 继续模型。
  验证：runtime/core/capability failure path tests。
  来源：Requirement: 最小真实 Model Provider；Requirement: 最小 Capability Read Tool；Requirement: Terminal Consistency And Safe Error。

- [x] T071 添加 capability result history tests，断言 read result 持久化为 visible `role=CAPABILITY_RESULT` SessionMessage，默认 conversation history 不返回，`includeCapabilityResults=true` 时返回，并可用于 current request tool state/context 重建。
  验证：session history and tool state reconstruction tests。
  来源：Requirement: 最小 Capability Read Tool；Requirement: Web Submit Stream And History。

- [x] T072 添加 internal cancellation propagation tests，断言 runtime、core、model、capability 和 timeline stream 接收并传播 `AbortSignal`；内部 abort 只来自内部 timeout、server shutdown、测试注入 abort 或 transport disconnect cleanup，并且不暴露 cancel route、cancel runtime command、持久化 canceled terminal state、request-control 状态机或用户 `REQUEST_CANCELED` 投影。Gateway public port 保持 async；当前 gateway-local 只有 SQLite local atomic persistence transaction，以一致性为先，不承诺事务中途 abort，远程、长耗时或可取消的 Gateway cancellation deferred。
  验证：cancellation propagation contract/characterization tests；route/contract negative assertions。
  来源：Requirement: Terminal Consistency And Safe Error；AGENTS 技术约束。

- [x] T073 添加 create-session request schema negative tests，断言 `POST /api/v1/sessions` request body 只允许 `locale?`，并拒绝 `sessionId`、`idempotencyKey`、owner 字段、title、status、deploymentMode、channel、metadata、stream/ws path 或其他 session detail 字段；`tenantId`/`subjectId` 只能来自可信 identity boundary。
  验证：Web route schema/contract tests 覆盖 forbidden fields，并断言请求体 owner 字段不能覆盖当前身份。
  来源：Requirement: 最小问答主流程；Requirement: Owner Scope And No-op Boundaries。

- [x] T074 添加 submit request schema negative tests，断言两条 submit route 均拒绝客户端提供的 `requestId`、`language`、`submittedAt`、附件对象、owner 字段、metadata 或其他 non-minimal envelope 字段；session-scoped submit 不接受 body `sessionId`，convenience submit 只允许 `sessionId?` 作为会话选择字段。
  验证：Fastify inject submit schema negative tests 覆盖 forbidden fields，并断言 channel/runtime 生成权威 request identity 和 submitted timestamp。
  来源：Requirement: Web Submit Stream And History；Requirement: Owner Scope And No-op Boundaries。

- [x] T075 运行构建、单元、contract、architecture、product-path OpenAI E2E 和 OpenSpec 验证命令并记录结果。
  验证：`npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture`、`npm run test:e2e:openai`、`openspec validate --all --strict`。
  来源：Requirement: Minimal Kernel Verification。

- [x] T076 清理实现产生的临时 fixture、debug logging、未使用 public export 和文档待确认项。
  验证：`git diff` code review；`rg "TODO|debug|console\\.|MODEL_INPUT|MODEL_OUTPUT" packages tests` 人工确认无违规残留。
  来源：design.md 风险与取舍；safe logging 约束。

## 10. 产品化 Package 目录结构

- [x] T077 固化每个 package 的目标目录结构，确保 `designs/module-structure.md` 覆盖 `agent-app`、`agent-runtime`、`agent-core`、`agent-channel-web`、`agent-model`、`agent-capability`、`agent-context-engine`、`agent-session`、`agent-platform-gateway-local`、`agent-observability`、`agent-contracts` 和 minimal stub packages，并明确 `src/index.ts` 只能作为 public barrel 或轻量 factory export。
  验证：OpenSpec review 检查 `designs/module-structure.md` 覆盖所有 package 分类；`openspec validate --all --strict`。
  来源：Requirement: Productized Package Module Structure；designs/module-structure.md。

- [x] T078 重排 `agent-runtime`：按 `lifecycle/`、`assembly/`、`timeline/`、`terminal/`、`checkpoints/`、`audit/` 拆分 submit admission、dispatcher、cancellation、assembly binding、timeline event/stream/sequence、terminal commit、failure normalization、no-op checkpoint 和 audit call 实现；`src/index.ts` 只保留 public exports。
  验证：runtime foundation、terminal consistency、output guard、owner scope、cancellation propagation 相关测试通过；code review 断言 `packages/agent-runtime/src/index.ts` 不包含主 lifecycle/state machine 实现。
  来源：Requirement: Productized Package Module Structure；Requirement: Agent Core 通过目标执行边界；Requirement: Terminal Consistency And Safe Error。

- [x] T079 重排 `agent-core`：按 `agent/`、`model/`、`tools/`、`timeline/` 拆分 minimal agent、execution loop、model request builder、output guard、tool loop、tool call state、capability resolution 和 core timeline authoring；保持 core 不 hardcode read 文件访问。
  验证：`tests/agent-kernel/main-path.test.ts`、`tests/agent-kernel/tool-loop.test.ts`、`tests/agent-kernel/output-guard.test.ts` 和 model boundary assertions 通过；code review 断言 `packages/agent-core/src/index.ts` 只导出 public API。
  来源：Requirement: Productized Package Module Structure；Requirement: Context 和 Model 调用边界；Requirement: 最小 Capability Read Tool。

- [x] T080 重排 `agent-channel-web`：按 `routes/`、`schemas/`、`projections/`、`auth/` 拆分 session/request/stream/conversation route、public DTO schema、SSE/history projection 和 identity extraction；public alias 只能停留在 channel projection/schema 层。
  验证：`tests/agent-kernel/web-boundaries.test.ts` 通过；route registry、submit schema、session list、conversation history 和 stream projection negative tests 通过；code review 断言 Fastify route/schema bodies 不在 `src/index.ts`。
  来源：Requirement: Productized Package Module Structure；Requirement: Web Submit Stream And History。

- [x] T081 重排 `agent-model`：按 `providers/openai/`、`credentials/`、`testing/` 拆分 OpenAI request mapper、stream normalizer、tool-use normalizer、safe error mapper、credential resolver 和 deterministic provider；产品 provider factory 不得依赖 `testing/`。
  验证：`packages/agent-model/tests/openai-provider.test.ts`、`tests/e2e/openai-product-path.test.ts` 和 `npm run test:e2e:openai` 通过；architecture/test review 断言 product composition 不 import deterministic provider。
  来源：Requirement: Productized Package Module Structure；Requirement: 最小真实 Model Provider。

- [x] T082 重排 `agent-capability`：按 `catalog/`、`invocation/`、`builtins/read/` 拆分 capability catalog、descriptor resolution、invocation service、input validation、read descriptor、path guard、line slice 和 read capability 实现；read 仍作为 capability boundary 实现而不是 core helper。
  验证：`packages/agent-capability/tests/read-capability.test.ts`、`tests/agent-kernel/tool-loop.test.ts` 和 read negative tests 通过；code review 断言 `src/index.ts` 不包含 read path/file slicing 实现。
  来源：Requirement: Productized Package Module Structure；Requirement: 最小 Capability Read Tool。

- [x] T083 重排 `agent-context-engine` 和 `agent-session`：context engine 按 `assembly/`、`render/`、`budget/` 拆分 context assembly、active context selection、model input render、prompt profile、电信术语规则和 window budget；session 按 `services/`、`mappings/` 拆分 session preparation、history query、conversation query、gateway record mapping 和 cursor mapping。
  验证：context render、telecom term、history/conversation、current request message 和 agent-kernel integration tests 通过；code review 断言 public Web alias 不进入 session package。
  来源：Requirement: Productized Package Module Structure；Requirement: Context 和 Model 调用边界；Requirement: Web Submit Stream And History。

- [x] T084 重排 `agent-platform-gateway-local`、`agent-observability` 和 `agent-app`：gateway-local 按 `db/`、`stores/`、`mappings/` 拆分 persistence owner；observability 按 `errors/`、`logging/`、`audit/` 拆分 safe error、redaction、logger 和 no-op audit writer；app 按 `config/`、`composition/`、`assembly/`、`server/`、`auth/` 拆分 SystemConfig validation、model profile registry、AgentDefinition parser/compiler/registry、product/test composition、Fastify server 和 local auth。
  验证：app composition smoke、owner scope、safe-data/log assertion、gateway/history/runtime integration tests 通过；code review 断言产品 composition 不 import test-only entries。
  来源：Requirement: Productized Package Module Structure；Requirement: Owner Scope And No-op Boundaries；Requirement: Minimal Kernel Verification。

- [x] T085 增加 architecture guard 和 negative fixtures，防止结构回退：跨 package private path import 必须失败；产品代码 import 其它 package `testing/` entry 必须失败，并有 negative fixture 覆盖；核心 implementation package 不得作为单文件 `src/index.ts` 交付。
  验证：`npm run lint:architecture`；新增或更新 architecture tests/fixtures 实际触发 private import、testing-entry leakage 和 single-file implementation regression 失败并断言。
  来源：Requirement: Productized Package Module Structure；Requirement: Minimal Kernel Verification。

- [x] T086 执行产品化结构重排后的全量回归，确认目录重排没有改变本 change 行为契约。
  验证：`npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture`、`npm run test:e2e:openai`、`openspec validate --all --strict`；并执行 `rg "TODO|debug|console\\.|MODEL_INPUT|MODEL_OUTPUT" packages tests --glob '!**/dist/**'` 确认无违规残留。
  来源：Requirement: Productized Package Module Structure；Requirement: Minimal Kernel Verification。

## 11. 目标态 TS 配置所有权与 Agent Assembly 编译

以下任务替换早期最小配置假设，也替换上一版“把所有配置塞进 public `SystemConfig`”的过宽设计。T030/T061 对真实 OpenAI 产品路径的约束仍成立，但产品配置不得停留在“一个全局 OpenAI profile + 直接默认 assembly”的实现路径，也不得形成 SystemConfig 总配置桶；必须按 `Config/Resources/ResourceProviders/Plugins` 输入面和 system/component、Agent、runtime-safe assembly 所有权类落地。

- [x] T087 收敛 `agent-contracts/app` 配置边界：移除 public catch-all `SystemConfig`、`RuntimePathsConfig`、`ChannelConfig`、`GatewayAdapterConfig`、`CapabilityProviderConfig`、`ResourceInventory`、`AgentAssemblyCompiler` 输入/输出等 app-internal 配置总线契约；仅保留 downstream 确有公共消费需求的 runtime-safe assembly/registry、model profile shape、safe degradation/unavailable shape 稳定边界。
  验证：`npm run test:contract`；contract/API assertion 断言 runtime/core/context/model/capability/session/gateway public contracts 不接收 raw env/file config、component config DTO、compiler input/output、raw credential、provider-native payload、SQLite row、owner identity、client metadata；source scan 断言 `agent-contracts/app` 未继续导出配置总桶。
  来源：Requirement: App Configuration Contract Refinement For Minimal Kernel；Requirement: Target-State TS Configuration Ownership And Agent Assembly Compilation。

- [x] T088 重构 `agent-app/config/` 为 TS 配置唯一感知层：file loader 只读取 `packages/agent-app/config/default-system.yaml`，`env.ts` 只读取 credential resolver 所需 env secret override；default-system schema 必须覆盖 active agent、OpenAI model profile、credentialRef、SQLite local gateway path、workspace root、local auth/channel/no-op provider selection；SQLite local gateway、channel、observability/no-op、provider adapter 和 model profile registry 不再合并进 public `SystemConfig`，组件也不得感知配置文件来源。
  验证：config ownership tests 覆盖 `default-system.yaml` 只在 `agent-app/config` 读取、default-system 不包含 Agent binding/workspace/framework internals/raw secret、SQLite 默认目标在 `data/system`、workspace root 默认支持 `workspaces/default-agent` 解析、主路径目录创建/校验不覆盖已有 data/workspace、SQLite file 被转换成 local gateway internal options、channel config 不进入 AgentDefinition/runtime public contract、model profile 使用 credentialRef 且无 raw credential、deterministic/test provider 不能被产品 config 选择；architecture/source assertion 断言下游 package 不 import `agent-app/config`、不读取 `process.env`、不读配置文件路径；source/review assertion 断言未实现 `config/application.yaml`、`config/agents/default-agent/agent.yaml`、`bin/` 脚本、zip/staging、前端托管、完整 logs/run 管理、附件/归档/upload-temp 初始化和升级流程。
  来源：Requirement: Target-State TS Configuration Ownership And Agent Assembly Compilation；Requirement: 最小真实 Model Provider。

- [x] T089 重构 `agent-app/assembly/` 为 Agent 业务配置 owner：`AgentDefinition`、parser、内置 default-agent loader、resource registry、resource provider registry、app-internal compiler 和 registry implementation 均留在 `agent-app`；产品 `AgentDefinition` 来源固定为 `packages/agent-app/config/default-agent.yaml`，且只包含 Agent 业务装配字段。
  验证：parser/compiler tests 覆盖合法 default-agent.yaml、缺失 default-agent.yaml fail closed、agentId mismatch、unsafe id、missing model/prompt/capability refs、disabled read binding、非法 capability source/type、workspace 指向系统目录、resource path escape；negative tests 断言 AgentDefinition 拒绝 raw credential、provider endpoint、SQLite file、channel transport、gateway endpoint、tenant/subject 和 client metadata；source assertion 断言 runtime/core/context/capability 无 `default-agent` fallback。
  来源：Requirement: Target-State TS Configuration Ownership And Agent Assembly Compilation；Requirement: Runtime 接受请求并固化 Agent Assembly。

- [x] T090 重接产品 composition 为唯一启动路径：`built-in default-system Config -> agent-app internal component options + Resources + ResourceProviders + Plugin definitions disabled -> built-in default-agent AgentDefinition load/compile -> AgentAssemblyRegistry/model profile registry/capability catalog/SQLite gateway/no-op providers -> runtime/session/core/context/model/capability/channel`；移除产品路径中的硬编码 default assembly registry、`hostedAgentId ?? "default-agent"` fallback、exactly-one global OpenAI selection 和 public compiler DTO dependency。
  验证：app composition smoke 覆盖产品路径注入 compiled registry、selected OpenAI profile、SQLite local gateway 和 no-op providers，并断言产品 composition 不注入 `createTestGatewayStores` 和其它内存-only fake gateway；negative tests 覆盖无 active assembly、selected profile disabled/missing、read 未绑定时模型不可见；architecture/source assertion 断言 runtime/core/context/model/capability/session/gateway 不 import `agent-app/config` private files、`agent-app/assembly` private files 和读取 raw env。
  来源：Requirement: Target-State TS Configuration Ownership And Agent Assembly Compilation；Requirement: Productized Package Module Structure；Requirement: Owner Scope And No-op Boundaries。

- [x] T091 调整主路径选择逻辑，使 context/model/capability 全部从 accepted assembly 获取配置：model selection 按 `defaultModelProfileId` 优先、`modelProfileIds[0]` 兜底的固定顺序执行，prompt selection 按 `defaultPromptTemplateId` 优先、`promptTemplateIds[0]` 兜底的固定顺序执行，capability visibility 使用 assembly bindings；资源注册和 Agent binding 必须分离，未被 accepted assembly 选择的 model profile、prompt template、capability descriptor、plugin-contributed definition 不影响当前 request。
  验证：integration tests 覆盖多个 model profile 但只调用 accepted assembly 选择项、active assembly 更新不影响已接受 request、registered-but-unbound read 不披露 tool、unselected profile 不触发 provider factory、prompt default/fallback 选择，并断言 Agent tool loop 使用 accepted assembly 的 `runtimeSettings.maxToolIterations` 而不是 core 构造默认值；model boundary tests 仍断言 ModelInvocationRequest 扁平且只含 credentialRef。
  来源：Requirement: Target-State TS Configuration Ownership And Agent Assembly Compilation；Requirement: Context 和 Model 调用边界；Requirement: 最小 Capability Read Tool。

- [x] T092 执行 TS 配置所有权纠偏后的全量一致性验证，确认 T087-T091 的契约、实现和测试闭合，且未把非 TS 运行时机制或后续打包机制混入当前目标，也未把多 provider fallback、完整 gateway configuration、完整 capability source/governance、动态 plugin loading、完整本地运行包打包/启动/前端托管/升级保留、其它后续能力隐式纳入本 change 产品路径。
  验证：`openspec validate --all --strict`、`npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture`、`npm run test:e2e:openai`；code review 检查 T087-T091 的验证证据覆盖 contract 收敛、config ownership、agent definition parser/compiler、product composition、accepted assembly selection、主路径最小依赖和 source/architecture negative assertions。
  来源：Requirement: Minimal Kernel Verification；Requirement: Target-State TS Configuration Ownership And Agent Assembly Compilation。

- [x] T093 调整测试归属结构：单 package public API、port、adapter、schema 或 helper 行为测试放入对应 `packages/<package>/tests/`；根 `tests/` 仅保留 architecture、contract、跨模块 `agent-kernel` characterization、真实 e2e 和 fixtures；不得按本 change 的“minimal kernel”范围名组织长期测试目录。
  验证：目录扫描确认 `tests/agent-kernel` 不包含单模块 provider/capability 单元测试，`packages/agent-model/tests/openai-provider.test.ts` 和 `packages/agent-capability/tests/read-capability.test.ts` 通过 package public exports 覆盖对应单模块行为，`tests/e2e/openai-product-path.test.ts` 承载真实 OpenAI 产品路径验收；`npm test`、`npm run test:e2e:openai`、`npm run test:contract`、`npm run lint:architecture`、`openspec validate --all --strict` 通过。
  来源：Requirement: Productized Package Module Structure；designs/module-structure.md。

- [x] T094 清理最小路径实现中无实际业务作用的说明型 boundary 契约与汇总：删除 `agent-contracts` 中仅用于模块职责说明、未参与主路径 DTO/enum/port/schema 交换的 `*Boundary` interface，例如 `AgentCoreBoundary`、`RuntimeBoundary`、`CheckpointBoundary`、`PendingInputBoundary`、`WebChannelBoundary`、`ContextEngineBoundary`、`ModelProviderBoundary`、`CapabilityLifecycleBoundary`、`AttachmentRuntimeBoundary`、`SessionStateBoundary` 和 `GatewayBoundary`；同步删除或内联最小路径实现中仅用于 `createAppBoundarySummary()`/composition 自描述、无实际业务作用的 boundary 常量和汇总返回值，避免继续把架构说明误暴露为核心公共契约。保留仍属于真实核心契约的 `HookBoundary` / `BoundaryMutation` 等泛型边界类型。该清理按 AGENTS.md 的“简单优先、外科手术式修改”执行，不为这批删除新增负向用例或新的说明型替代接口。
  验证：`npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture`、`openspec validate --all --strict`；code review 检查 `agent-contracts` public exports 不再包含仅承载职责文案的 `*Boundary` interface，主路径行为与现有最小路径测试结果保持一致。
  来源：AGENTS.md 开发准则（简单优先、外科手术式修改）；Requirement: Productized Package Module Structure；Requirement: Minimal Kernel Verification。

- [x] T095 收缩 `agent-contracts/app` 中无真实跨模块交换价值的 app-level 占位契约：删除 `SecretResolverEnvelope`、`SafeUnavailableError`、`DegradationEvent` 和 `DegradationResult`，避免把 secret resolver 实现形态、degradation helper shape 或 observability/timeline 已有语义重复暴露为核心公共契约；同步删除或改写仅为这四个类型存在的 contract tests，保留仍被真实产品路径消费的 `ModelProfile` 等稳定 app contract。
  验证：`npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture`、`openspec validate --all --strict`；code review 检查 `packages/agent-contracts/src/app/index.ts` 不再导出上述四个类型，且测试不再为已删除占位契约保留仅自证存在的断言。
  来源：AGENTS.md 开发准则（简单优先、外科手术式修改）；Requirement: App Configuration Contract Refinement For Minimal Kernel；Requirement: Minimal Kernel Verification。

## 12. Runtime-owned User Session Scope Refresh

以下任务刷新当前最小流程的 session/scope 设计，不新增 change。它们替换 T004/T005/T050/T051 中“channel 可直接委托 `agent-session`”和 owner-only session lookup 的旧实现假设，但保留这些任务已经确认的最小 Web route、public DTO 字段和 history 分页语义。唯一产品路径是 `agent-channel-web -> agent-runtime session/request facade -> runtime internal Agent Scope resolver -> agent-session UserSessionPort -> gateway owner+agent scoped records`。旧路径必须删除，不能以兼容 shim、deprecated alias、adapter wrapper 或未使用 public export 的形式保留。`agentResolver` 是 `agent-runtime` 内部实现，不进入 `agent-contracts`。

- [x] T096 刷新 `agent-contracts` session/runtime/gateway 契约：在 `agent-contracts/session` 定义领域 `UserSessionPort` 和领域对象/命令/查询，例如 `UserSession`、`CreateUserSessionCommand`、`RequireUserSessionQuery`、`ListUserSessionsQuery`、`UserSessionPage`、`ListSessionMessagesQuery` 和 `SessionMessagePage`；`UserSession` 必须携带 `tenantId`、`subjectId`、`agentId`、`sessionId`、`title?`、`createdAt`、`updatedAt`。删除或替换 stale `SessionHistoryQuery`、`SessionConversationQuery`、`CurrentRequestConversationQuery`、`ListUserSessionConversationQuery`、`UserSessionConversationPage` 和重复 `UserSessionListEntry`，不得形成第二套 session history/message API，且不得通过 deprecated type alias 保留旧名。runtime-facing session facade contract 只表达 channel 可调用的 create/list/message/require session 操作，不暴露 agent resolver。gateway `SessionRecord`、session list/message/current-request query 和 message/active-context 相关 Record/Query 必须显式携带 `agentId` 与 `tenantId`/`subjectId`。
  验证：`npm run test:contract`；contract/API assertion 断言 `agent-contracts/session` 不导出 Web DTO alias、gateway `*Record` 或 stale parallel history API，gateway record/query 不缺 `agentId`，runtime contracts 不导出 agent resolver。
  来源：Requirement: User Session Contract Refinement For Minimal Kernel；Requirement: Runtime 接受请求并固化 Agent Assembly；Requirement: Web Submit Stream And History。

- [x] T097 刷新 `agent-runtime` session/request admission：新增或收敛 runtime session facade，作为 `agent-channel-web` 创建 session、列 session、查 conversation 和 submit 前 require session 的唯一入口；runtime 内部解析 trusted Agent Scope，当前 single hosted Agent 从 app composition 注入的 active hosted Agent selection 得到 `agentId`，后续 multi hosted Agents 路由只能替换 runtime 内部 resolver。runtime 调用 `agent-session` 的 `UserSessionPort`，并在 submit acceptance 前按 persisted `UserSession.agentId` 校验 owner+agent scope；同 session active-run conflict key 必须包含 owner+agent+session。客户端 body、metadata、模型输出或 capability 参数不得提供或覆盖 `agentId`。
  验证：runtime characterization/contract tests 覆盖 create/list/conversation/submit admission 均经 runtime session facade、single hosted resolver 固化 `agentId`、existing session submit 校验 persisted `agentId`、跨 owner/cross-agent session 返回 safe not-found、同 owner+agent+session active-run conflict 生效；source assertion 断言 `agent-runtime` 不从 channel DTO 读取 `agentId`，`agent-contracts` 不存在 public agent resolver。
  来源：Requirement: Runtime 接受请求并固化 Agent Assembly；Requirement: Owner Scope And No-op Boundaries。

- [x] T098 刷新 `agent-channel-web` session 路由依赖：删除 channel 内自定义 session abstraction 和对 `agent-session`/gateway store 的直接依赖；不得保留转发到 runtime 的同名 shim 或未使用兼容 port。`POST /api/v1/sessions`、`GET /api/v1/sessions`、`GET /api/v1/sessions/{sessionId}/conversation`、两条 submit route 和 stream route 只调用 runtime-facing ports。channel 仍独占 public Web DTO schema/projection：`displayTitle`、`lastActivityAt`、public `cursor/nextCursor` 和空 `attachments?: []` 只在 channel 层出现；request body 中任何 owner/agent 字段必须 schema validation failed。
  验证：Fastify route/Web contract tests 覆盖 create/list/conversation/submit 的 runtime facade 调用、public DTO 字段不变、agent 字段被拒绝；architecture/contract checks 断言 channel 产品依赖只指向 runtime-facing boundary，不定义 channel-owned session abstraction，不把 public alias 传入 runtime/session。
  来源：Requirement: Web Submit Stream And History；Requirement: Productized Package Module Structure。

- [x] T099 刷新 `agent-session` 实现为 `UserSessionPort`：`agent-session` 只暴露领域对象和领域 read model，负责 `UserSession`/conversation 与 gateway `*Record` 的映射、session 创建时 active context 初始化、session require/list/conversation 的 owner+agent scoped 查询、current request conversation 读取所需的领域映射；不得返回 gateway `*Record`、SQLite row、public Web alias 或 `Record<string, unknown>`。领域 query 使用 trusted `IdentityContext` + trusted `agentId`，不新增 generic `OwnerScope` DTO。
  验证：`packages/agent-session` tests 覆盖 create/require/list/conversation/current-request mapping、active context initialization、cross-owner/cross-agent fail closed、public alias 不泄漏；source/API assertion 断言 package public return 不含 `*Record`、`displayTitle`、`lastActivityAt`、public `cursor`、`nextCursor`。
  来源：Requirement: User Session Contract Refinement For Minimal Kernel；Requirement: Context 和 Model 调用边界。

- [x] T100 刷新 gateway-local persistence owner 和 gateway contract 实现：SQLite row/entity 仍停留在 `agent-platform-gateway-local` 私有实现；session、message、active-context、timeline/run 关联查询和写入在主路径持久化事实中显式保存并过滤 `agentId`、`tenantId`、`subjectId`、`sessionId`。session list 按 owner+agent 查询并使用 `updatedAt desc, sessionId asc` 稳定排序；conversation/current-request query 按 owner+agent+session/request/run 查询；跨 owner/cross-agent 必须返回 safe not-found/empty page，不得只按 `tenantId`/`subjectId` 或 `sessionId` 命中。gateway public port 是真正的 persistence slow boundary，保持 async；当前 gateway-local SQLite local atomic persistence transaction 以一致性为先，不承诺事务中途 abort。远程、长耗时或可取消的 Gateway cancellation deferred；gateway-local 内部 mapper/row conversion 和小数据内存结构不单独提升为跨模块慢边界。
  验证：gateway contract tests 和 SQLite adapter tests 覆盖 `agentId` 持久化、索引/where 条件、跨 owner/cross-agent negative case、stable sorting、conversation before-cursor、current-request query、active context load/append；architecture/source assertion 断言 SQLite row/entity 不从 gateway-local private implementation 泄漏。
  来源：Requirement: Owner Scope And No-op Boundaries；Requirement: Web Submit Stream And History；AGENTS 架构边界。

- [x] T101 执行 session/scope 刷新后的跨模块一致性验证：补齐 contract、architecture、Web route、runtime admission、agent-session、gateway-local 和 agent-kernel characterization tests，确认 create session、list sessions、conversation history、convenience submit、session-scoped submit 和 SSE stream 的可观察行为均满足 runtime-owned Agent Scope、owner scope 与 agent scope 双隔离、DTO/DO/PO 边界隔离。同步清理只为历史路径存在的测试夹具、mock port、helper 和未使用 public export。
  验证：`openspec validate --all --strict`、`npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture`、`npm run test:e2e:openai`；code review 检查没有新增 DTO/DO/PO 混用、compatibility shim、unused export 或历史测试夹具残留；边界逃逸由 T102 的架构/contract 用例验证，而不是只靠人工搜索。
  来源：Requirement: Minimal Kernel Verification；Requirement: User Session Contract Refinement For Minimal Kernel；Requirement: Web Submit Stream And History。

- [x] T102 增加 session/scope 架构和 contract 用例，并按 AGENTS.md 验证门禁实现。用例设计优先正向、黑盒和 public-boundary：Web route tests 断言 public request/response、schema 拒绝客户端 owner/agent 字段、跨 owner/cross-agent 访问 safe not-found；runtime public-boundary tests 断言 accepted session/run facts 使用 trusted identity 和 trusted Agent Scope，且不接受客户端 Agent Scope；session public contract tests 断言返回领域对象/read model 而非 Web DTO 或 persistence record；gateway public contract tests 断言主路径 session/message/active-context record/query 必须 owner+agent scoped。架构用例只验证 package ownership 和 public contract 边界，不要求特定私有调用顺序、helper 名称或目录内部形状。复用已有 architecture guard：`no-channel-to-lifecycle-owners` 已覆盖 channel 产品代码不得依赖 `agent-session`，但需要补齐对应 negative fixture/expected rule；现有 `no-channel-web-to-gateway-records` 只覆盖 channel 不得使用 gateway record contract，还需要新增或扩展类别级 architecture rule/fixture，覆盖 channel 产品代码不得依赖 gateway adapter implementation/public package。其它负向 fixtures 只覆盖类别级架构边界，例如 forbidden cross-package dependency、runtime-internal resolver 作为 public contract 泄漏、DTO/Record 跨层泄漏、product path 引入 testing fixture/mock/no-op 替代；不得为单个历史符号或某个实现 bug 增加命名级负例。
  验证：`npm run lint:architecture`、architecture tests 和 contract/API assertions 覆盖上述正向 public-boundary 用例；`tests/architecture/dependency-rules.test.ts` 或等价架构测试实际触发 channel -> session 和 channel -> gateway adapter negative fixtures 失败并断言命中对应规则；source/architecture assertion 只用于 AGENTS.md 允许的架构边界和 forbidden pattern，不锁死无关私有实现细节。
  来源：Requirement: Productized Package Module Structure；Requirement: Minimal Kernel Verification；Requirement: User Session Contract Refinement For Minimal Kernel。

## 13. Product Naming And Session Message Cleanup

以下任务在当前 change 内清理已实现最小路径的命名和持久化组合形态，不新增 change。实施路径唯一：删除 scope-word implementation names，不保留 deprecated alias；session 读取统一返回 `SessionMessage` read model；本地 gateway 产品路径只保留 SQLite-backed stores；channel 只依赖 runtime-facing request/session/event-stream ports，并在 channel 层投影 Web DTO。

- [x] T103 清理 implementation 中以 `Minimal`/`Kernel` 表达范围而非职责的 public class/factory/type 名称：`MinimalRuntimeKernel` 改为 `RequestLifecycleCoordinator`，`createMinimalRuntimeKernel` 改为 `createRequestLifecycleCoordinator`；`MinimalSessionService` 改为 `UserSessionService`；`MinimalAgent` 改为 `DefaultAgent`；`MinimalContextEngine` 改为 `DefaultContextEngine`。同步更新 package public exports、app composition、tests 和 architecture fixtures；不得通过 deprecated alias 保留旧名。
  验证：`rg "MinimalRuntimeKernel|createMinimalRuntimeKernel|MinimalSessionService|createMinimalSessionService|MinimalAgent|createMinimalAgent|MinimalContextEngine|createMinimalContextEngine|MinimalKernelGatewayBundle|LocalSqliteMinimalKernelGateway|createLocalSqliteMinimalKernelGateway|InMemoryMinimalKernelGateway|createInMemoryMinimalKernelGateway" packages tests --glob '!**/dist/**'` 无命中；`npm run build`、`npm test`。
  来源：AGENTS.md 简单优先；Requirement: Productized Package Module Structure；Requirement: User Session Contract Refinement For Minimal Kernel。

- [x] T104 收敛 session/message contract 命名：`UserSessionPage.entries` 直接使用 `UserSession[]`，删除 `UserSessionListEntry`；领域、runtime 和 gateway 的 conversation 命名统一为 message 命名，例如 `ListSessionMessagesQuery`、`SessionMessagePage`、`ListCurrentRequestMessagesQuery`、`RuntimeListSessionMessagesQuery`、`ListSessionMessagesRecordQuery`、`ListCurrentRequestMessagesRecordQuery` 和 `SessionMessageRecordPage`。gateway history record page/entry 改为 `SessionHistoryPage`/`SessionHistoryEntry`。当前 request query 不与 session message list query 合并，因为前者必须携带 `requestId/runId/offset/includeHidden`，后者使用 session-level `beforeCursor/includeCapabilityResults`；两者只共享 `SessionMessagePage` 返回形态。
  验证：`npm run test:contract`；contract/API assertion 断言旧 conversation/current-request/history entry/page 名称不再由 `agent-contracts` public exports 暴露，且 Web public `cursor/nextCursor` 仍只在 channel projection 层出现。
  来源：Requirement: User Session Contract Refinement For Minimal Kernel；Requirement: Web Submit Stream And History。

- [x] T105 收敛 channel web 对 runtime stream 的依赖命名：`RuntimeTimelinePort`/`RuntimeTimelineStreamRequest` 改为 runtime event stream 边界，channel 注入名改为 `eventStream`；`RegisterWebChannelOptions` 改为 `WebChannelDependencies`。channel 仍只从 runtime event stream 读取 canonical runtime events，并投影为 public `StreamEnvelope`，不得把 runtime timeline 或 gateway timeline record 作为 Web DTO 暴露。
  验证：Web route/stream tests 保持通过；architecture/contract source assertion 覆盖 channel 不依赖 gateway timeline record，且 `RuntimeTimelinePort`/`RegisterWebChannelOptions` 旧名不再出现在 `packages/agent-channel-web` 和 `packages/agent-contracts/src/runtime`。
  来源：Requirement: Web Submit Stream And History；Requirement: Productized Package Module Structure。

- [x] T106 删除 all-in-one in-memory kernel gateway 产品实现，保留 SQLite 这一种 local persistence implementation。`LocalGatewayStores` 只作为组合 store bag 类型表达 requestRuns/sessions/messages/activeContext/timeline/checkpoints；SQLite 实现命名为 `SqliteGatewayStores`，factory 为 `createSqliteGatewayStores`。测试如需隔离存储必须使用临时 SQLite store helper，不从产品 package 导出 in-memory fake。
  验证：gateway/app/tests 改用 `createSqliteGatewayStores` 或测试临时 SQLite helper；`rg "in-memory-minimal-kernel-gateway|createInMemoryMinimalKernelGateway|InMemoryMinimalKernelGateway|MinimalKernelGatewayBundle|LocalSqliteMinimalKernelGateway|createLocalSqliteMinimalKernelGateway" packages tests --glob '!**/dist/**'` 无命中；`npm run lint:architecture` 不出现 channel -> gateway adapter 边界回归。
  来源：AGENTS.md 架构边界；Requirement: Owner Scope And No-op Boundaries；Requirement: Productized Package Module Structure。

## 14. Two-layer Package Dependency And Contract Subpath Guards

以下任务在当前 change 内落地两层跨 package 依赖门禁。第一层约束产品 implementation package 不得横向依赖其它 implementation package；第二层约束每个 package 只能消费架构授权的 `agent-contracts/<subpath>`。第二层白名单必须按循环依赖风险和模块职责边界定义，不按当前实现已有 import 倒推；因此当前实现中的 `agent-core -> contracts/gateway`、`agent-context-engine -> contracts/runtime` 等路径若存在，应作为待收敛问题处理，而不是纳入白名单。

- [x] T107 增加 implementation package dependency firewall：除 `agent-app` composition root、`agent-common`、`agent-contracts`、`agent-test-kit` 和测试/fixture 外，产品 implementation package 的源码 import 和 `package.json` workspace dependency 均不得指向其它 implementation package；清理当前 manifest 中不再允许的横向 workspace dependency。
  验证：新增或扩展 architecture/package manifest tests 断言 `agent-core` 不声明 `@nextagent/agent-context-engine`、`@nextagent/agent-model`、`@nextagent/agent-capability` 等 implementation dependency，`agent-context-engine` 不声明 `@nextagent/agent-memory` 等 implementation dependency；`npm run lint:architecture` 对 representative implementation-to-implementation source import negative fixture 和 non-app implementation package manifest dependency negative fixture 均失败并命中明确规则；`npm run build`、`npm test` 通过。
  来源：Requirement: Productized Package Module Structure；Requirement: Minimal Kernel Verification；design.md 决策 13。

- [x] T108 增加 contract subpath allowlist architecture rule：禁止产品代码从 `@nextagent/agent-contracts` root aggregate import，且每个 package 只能导入 `designs/module-structure.md` 授权的 `agent-contracts/<subpath>`；`agent-app`、`agent-test-kit`、tests/fixtures 使用单独白名单。允许的新增 subpath 是 `agent-contracts/agent-assembly`，且只承载 runtime-safe assembly facts；不得把该 subpath 做成 Agent execution、raw config 或 app compiler contract 聚合入口。
  验证：`npm run lint:architecture` 和 architecture tests 覆盖 representative negative fixtures：`agent-model -> contracts/runtime`、`agent-capability -> contracts/model`、`agent-channel-web -> contracts/model`、`agent-channel-web -> contracts/session`、`agent-platform-gateway-local -> contracts/runtime`、任意产品 package root aggregate import、`agent-contracts/agent-assembly -> agent-contracts/runtime` 或 implementation package dependency；fixture 必须实际失败并断言命中对应规则。
  来源：Requirement: Contract Subpaths Remain Architecture-Owned；Requirement: Productized Package Module Structure；designs/module-structure.md。

- [x] T109 按唯一目标路径收敛当前实现差距：新增 `agent-contracts/agent-assembly` 并把当前所需 runtime-safe assembly facts 的 owning surface 放到该 subpath；`Agent` execution port 保留在 `agent-contracts/runtime`。`agent-context-engine` 需要 accepted assembly facts 时只导入 `agent-contracts/agent-assembly`，不得导入 `agent-contracts/runtime`。新增 `SessionMessageDraft` 到 `agent-contracts/session`，新增 runtime-owned `RunMessagePort.appendMessage(run, context, draft): Promise<MessageId>` 到 `agent-contracts/runtime`，并将 `Agent.execute` 签名收敛为 `execute(run, context, timeline, messages, signal): Promise<void>`。`agent-core` 通过 `RunMessagePort` 追加 assistant tool-use、capability result 和后续 execution-time session message，不再导入 `agent-contracts/gateway` 或构造 gateway record；runtime 实现该 port，负责用 trusted `RequestRun`/`RequestContext` 补齐 owner、agent、session、request、run、timestamp 坐标，写 gateway record 并追加 active context item；该 append port 不单独接收 `AbortSignal`，取消由 `Agent.execute` 的 runtime-owned `signal` 控制。
  验证：`rg "@nextagent/agent-contracts/gateway" packages/agent-core packages/agent-core/tests` 无产品命中；`rg "@nextagent/agent-contracts/runtime" packages/agent-context-engine packages/agent-context-engine/tests` 无产品命中；architecture/source assertions 断言 `agent-contracts/agent-assembly` 不依赖 `agent-contracts/runtime`、app/gateway/channel/model/capability subpath 或 implementation package；contract/API assertion 断言 `Agent.execute` 包含 `RunMessagePort` 参数、`RunMessagePort.appendMessage` 使用 `SessionMessageDraft` 且不接收 `AbortSignal`；相关 core/context/runtime/tool-loop/terminal/history characterization tests 通过；architecture/source assertions 断言未用新的宽 contract、compatibility shim、root aggregate import 或 private path import 替代旧依赖。
  来源：Requirement: Contract Subpaths Remain Architecture-Owned；Requirement: Agent Core 通过目标执行边界；Requirement: Context 和 Model 调用边界。

- [x] T110 明确并验证 `agent-app` composition root 例外：`agent-app` 的 contract subpath whitelist 和 implementation package dependency whitelist 只能承载在 `dependency-cruiser.config.cjs` 的固定 architecture policy 中，并由 `tests/architecture/dependency-rules.test.ts` 的固定 allowlist assertion 复核；不得在 package README、测试 fixture、package-local 常量或实现代码中另建第二份白名单。该例外必须包含装配所需的 `agent-assembly` subpath，但只允许 composition、config validation outcome、registry construction、assembly compiler output injection 和 server bootstrap，不得让 `agent-app` 承载 runtime lifecycle、core orchestration、Web projection、gateway persistence 或 model/capability business semantics。
  验证：`dependency-cruiser.config.cjs` 包含唯一 `agent-app` 例外 policy；`tests/architecture/dependency-rules.test.ts` 断言该 policy 是唯一 `agent-app` allowlist 来源，并覆盖其它 package 不能复用 app 例外；source assertions 断言 package README、测试 fixture、package-local 常量或实现代码未维护第二份白名单；architecture/source assertions 断言 `agent-app` 只做装配和配置/assembly 编译，未新增 runtime/core/channel/gateway/model/capability 主业务实现；`npm run lint:architecture` 通过。
  来源：Requirement: Productized Package Module Structure；Requirement: Target-State TS Configuration Ownership And Agent Assembly Compilation；design.md 决策 13。

- [x] T111 执行两层依赖门禁后的回归和文档同步：确认 OpenSpec change 文档、package README dependency notes、dependency-cruiser rules、architecture fixtures 和 tests 对同一目标矩阵保持一致；不得只更新 `tasks.md`。
  验证：`openspec validate --all --strict`、`npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture`；documentation consistency checks 覆盖 `proposal.md`、`design.md`、`designs/module-structure.md`、`specs/*/spec.md`、package README 和 architecture tests/fixtures 的两层约束表述一致，且无未解释的 allowlist 漂移。
  来源：Requirement: Minimal Kernel Verification；Requirement: Productized Package Module Structure；Requirement: Contract Subpaths Remain Architecture-Owned。

## 15. Gateway Persistence Idempotency Foundation

- [x] T112 固定 SQLite gateway-local 的专用事实表和锚点幂等原则：主路径 request run、session、message、active context、timeline event 和 checkpoint 不得使用 generic `records(store,key,json)` 承载业务事实；每个带 `idempotencyKey` 的 write operation 默认在锚点事实表保存 key，并通过 trusted owner/agent/session/request/run scope 建立唯一约束；不新增领域外 `operationKind`，不实现 request hash conflict detection。
  验证：OpenSpec spec/design 明确唯一实施路径；architecture/source assertion 断言 `SqliteGatewayStores` 不创建 generic `records` 表、不含 `message_idempotency` store、不含 `operation_kind`；`npm run test:contract` 覆盖 gateway record/query scope。
  来源：Requirement: Gateway-local uses dedicated fact tables and anchor idempotency；AGENTS.md 持久化 owner 和可重复验证要求。

- [x] T113 重构 SQLite gateway-local 为专用表实现，并清理已发现的幂等缺口：`messages`、`timeline_events`、`checkpoints` 使用锚点表 `idempotency_key` 唯一约束；terminal commit 锚到 `request_runs` terminal state，不再依赖独立 `terminal_commits` 表；message append 必须通过 `SessionMessageStoreGateway.appendSessionMessage(record, options)` 在一个 SQLite transaction 内完成 message、session `updatedAt` 和 active context item 写入，runtime 主路径不得拆成 `saveMessage` 后再 `appendItem`；简单 gateway 写入使用 `Record + write options`，不得为同形 `record + idempotencyKey` 增加专用 request wrapper；terminal commit 必须通过 `RequestRunStoreGateway.commitTerminal` 在一个 SQLite transaction 内完成 run terminal state、terminal message、active context item 和 terminal timeline event 写入；message append 重试不得重复 active context item，也不得在首次 message 已写入后因重试跳过缺失的 active context item。
  验证：新增或扩展 agent-kernel/gateway-local tests 覆盖 message append metadata/idempotency、active context retry-safety、timeline idempotent sequence、checkpoint idempotent save、terminal commit duplicate 且 terminal commit 一次写出 message/active context/timeline；architecture/source assertion 断言 SQLite message append 和 terminal commit composite write 均使用 transaction，且 runtime user/tool message append 调用 gateway message composite write；`npm run build`、`npm test`、`npm run lint:architecture`、`openspec validate --all --strict`。
  来源：Requirement: Gateway-local uses dedicated fact tables and anchor idempotency；Requirement: Terminal Consistency And Safe Error；Requirement: RequestContext 使用可恢复执行坐标。

- [x] T114 固化 gateway write、幂等和持久化事实建模原则到长期开发约束和归档同步计划：`AGENTS.md` 必须明确 simple write 使用 `Record + write options`、`idempotencyKey` 不进入 `*Record`、composite write 单事务、runtime/application 组装业务语义 Record、gateway-local 只处理机械持久化、主路径使用专用业务 store/table、锚点事实表幂等优先；本 change 的 `design.md` 必须列出归档时需要同步到 baseline OpenSpec design 的具体文档，避免最终归档只更新 spec 而遗漏 core-contracts、gateway-local、runtime、session 和 architecture/domain 文档。
  验证：code review 检查 `AGENTS.md` 和 `design.md` 对上述原则表述一致；`openspec validate --all --strict`。
  来源：本会话 gateway persistence/idempotency 设计结论；AGENTS.md 规格优先和归档前更新基线要求。

- [x] T115 收敛 gateway owner scope 共享 contract 和 message write contract：将 gateway shared owner scope contract 命名为 `OwnerScoped`，不得让 `*Record` 继承 `*Request`；owner-scoped Record、Query 和 Request 可统一复用该 contract。删除 public `SessionMessageStoreGateway.saveMessage(record, options?)`，最小内核 message write 只保留 `appendSessionMessage(record, options?)`，SQLite gateway-local 仅在事务内部保留私有 message insert/save helper。测试造数必须使用 public `appendSessionMessage`；需要模拟“message anchor 已存在但 active context item 缺失”的恢复场景时，只能通过测试 fixture 的 SQLite 物理故障注入，不重新开放 public standalone message write。
  验证：`npm run build`；architecture/source assertion 断言 gateway contract 不含 `OwnerScopedRequest` 和 public `saveMessage(record: SessionMessageRecord...)`，且保留 `OwnerScoped` 与 `appendSessionMessage(record, options?)`；runtime-foundation test 覆盖 active context 缺失修复。
  来源：本会话 gateway contract 命名和唯一 message write contract 设计结论；Requirement: Gateway-local uses dedicated fact tables and anchor idempotency。

- [x] T116 收敛 gateway 重复业务 vocabulary：将 DO 和 Record 共用的 durable scalar vocabulary 定义到 `agent-common`，包括 session message role/content/visibility、attachment media/status 和 pending input kind/status；`agent-contracts/session`、`agent-contracts/attachment` 和 `agent-contracts/runtime` 可 re-export 这些 type，但不得本地重复定义；`agent-contracts/gateway` 直接从 `agent-common` 引用这些 vocabulary，不得定义 `SessionMessageRecordRole`、`MessageContentRecordType`、`VisibilityRecordReason`、`AttachmentMediaRecordType`、`AttachmentValidationRecordStatus`、`AttachmentAvailabilityRecordStatus`、`PendingInputRecordKind` 或 `PendingInputRecordStatus`，也不得为了复用 vocabulary 依赖 sibling business subpath。保留 gateway-owned persistence-only vocabulary，例如 `VersionedUpdateStatus`、`TerminalCommitStatus` 和 `BlobRecordPurpose`。
  验证：`npm run build`；architecture/source assertion 断言 gateway contract 引用 common vocabulary、不含上述 duplicate record enum、不 import `../session`、`../runtime` 或 `../attachment`；`npm run lint:architecture`。
  来源：本会话 contract vocabulary owner 设计结论；Requirement: Contract Subpaths Remain Architecture-Owned。

- [x] T117 固化“同形同策”原则：相同语义类别、相同生命周期阶段、相同架构边界、相同安全/一致性不变量的对象和操作，必须使用同一 owner、命名规则、contract shape、write pattern、storage/idempotency 策略和验证方式；不得为同类情况新增平行 DTO、Record、Request、enum、port、store 或 helper。发现一个 case 需要调整原则时，必须先更新 OpenSpec 并应用到同类 case；真实例外必须在 OpenSpec design 中写明原因、适用范围、owner 和验证路径。
  验证：`AGENTS.md`、`specs/ts-core-contracts/spec.md` 和 `design.md` 均承载该原则；`openspec validate --all --strict`。
  来源：本会话 contract/gateway/idempotency/vocabulary 一致性设计结论；AGENTS.md 简单优先和规格优先。

- [x] T118 收敛幂等写入实现与设计一致性：session create 必须通过 `sessions` 锚点表保存 scoped `idempotency_key` 并在重复 key 时返回首次 created session；`SessionMessageDraft.idempotencyKey` 改为必填，避免 execution-time message append 走非幂等路径；RequestRun accepted create 保留 `request_runs` 锚点幂等，executing、terminal pending 和 diagnostic failure 更新改为纯 version CAS transition，不再传无法独立锚定的伪 operation key。同步更新 change proposal/design/spec/分册和 AGENTS.md，确保归档后长期文档不会保留冲突原则。
  验证：新增/扩展 agent-kernel tests 覆盖 public `POST /api/v1/sessions` 拒绝客户端 `idempotencyKey`、runtime session create 同 server-side/internal key 返回同一 session、gateway session anchor idempotency；architecture/source assertion 覆盖 `sessions` idempotency index、run CAS transition 不再包含 `:executing`/`terminal-pending`/`terminal-diagnostic` 伪 key；`npm run build`、`npm test`、`npm run lint:architecture`、`openspec validate --all --strict`。
  来源：本会话幂等写入全量审视结论；Requirement: Gateway-local uses dedicated fact tables and anchor idempotency；Requirement: Contract Subpaths Remain Architecture-Owned。

## 归档前更新基线检查（非实施任务）

实现完成并验证通过后，在归档前根据 proposal/design 的“归档前更新基线”处理：

- 将 `ts-minimal-agent-kernel` 行为契约提升到 `openspec/specs/ts-minimal-agent-kernel/spec.md`。
- 按需更新 `openspec/overview.md`。
- 按需更新 `openspec/designs/architecture/runtime-boundaries.md` 和 `openspec/designs/architecture/ts-backend-architecture.md`。
- 按需更新 `openspec/designs/domain/request-run.md`。
- 按需更新 `openspec/designs/contracts/core-contracts.md`。
- 按需更新 `openspec/designs/modules/*.md`。
- 将 gateway simple write 的 `Record + write options`、`idempotencyKey` 不进入 `*Record`、专用事实表、锚点幂等和 composite transaction 原则同步到长期 contract/module/architecture/domain 文档。
- 将 shared durable scalar vocabulary 归 `agent-common` 的原则同步到长期 contract design；清理长期文档中的 gateway `*RecordRole`、`*RecordType`、`*RecordKind`、`*RecordStatus` 副本。
- 将“同形同策”原则同步到长期 architecture/contract/module design；检查长期文档没有为同类对象或同类操作保留平行 owner、平行命名、平行 contract shape 或未说明的例外。
- 清理长期 `core-contracts.md` 中与当前实现不一致的旧 `*WriteRequest`/`*AppendRequest` 示例、`OwnerScopedRequest` 继承 Record 的示例、standalone `saveMessage` message write 入口和 gateway port signature。
- 将两层跨 package 依赖门禁和 contract subpath allowlist 提升到长期架构/模块设计文档。
- 确认 `AGENTS.md` 的长期开发约束与归档后的 OpenSpec baseline 一致。
- 更新 `openspec/designs/spec-to-design-map.md`。
- 检查长期文档没有重复定义同一状态机、API schema、数据 owner 或接口语义。
