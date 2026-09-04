# agent-runtime

## 职责

本模块在 trusted acceptance 后、持久化 root USER message 与 RequestRun 前调用 composition 注入的 accepted-input projector；它只携带并 schema 校验结构化 routing constraints，不解释 directive 文本。

拥有 request admission、runtime session facade、trusted Agent Scope resolution、RequestRun 创建、same-session lane scheduling、scheduler dispatch、request cancel/retry/edit、普通 submit acceptance 后的标题生成回调、session fork orchestration、runtime recovery、capability replay guard、timeline publication、checkpoint、lifecycle hook 调用、Agent policy registry/resolver、risk policy outcome orchestration 和 terminal commit boundary。

同时拥有 accepted-run execution workspace resolver：使用 app-composed `runtimeWorkspaceRoot`、runtime-facing `AgentAssembly.workspacePolicy`、trusted owner/agent/session/run facts 和 deployment mode 派生 run-scoped execution workspace view。

## 非职责

不处理 Web transport、业务语义路由、provider SDK、persistence driver、具体 model/tool 执行逻辑、memory trajectory/extraction/aging 语义、Session Activity 状态派生/订阅/消费或 app composition。runtime 不直接解析 raw config，不从请求体、模型输出或 capability 参数读取 owner/agent scope。

不执行 Skill resource projection、file tool path enforcement、sandbox adapter mapping 或 cleanup scheduling；这些由 capability、gateway adapter 和 app composition 通过 runtime resolver 结果协作完成。

## 依赖

允许依赖 `@nextagent/agent-common` 和 `@nextagent/agent-contracts/runtime`、`agent-contracts/session`、`agent-contracts/gateway`、`agent-contracts/agent-assembly`、`agent-contracts/observability` public subpaths。Session、Agent、gateway、hook、checkpoint 和 audit 的具体实现只能由 `agent-app` composition 注入；runtime 不依赖这些 implementation packages。

## 核心设计落点

- runtime 持久化并恢复 `RequestContext.agentTurnIndex` 与 checkpoint 同名坐标，校验其处于 accepted assembly `0..maxTurns`；normal/finalizing 由坐标推导，不新增 phase、finalization command 或平行状态机。
- runtime 继续独占 pause/resume、checkpoint、cancellation 和 terminal commit；Agent Core 的 finalizing 决策不能绕过真实模型失败、取消或 terminal hook 结果，也不能在 `index=maxTurns` 后执行 Tool。

- 落实 `architecture/runtime-boundaries.md` 的 request lifecycle ownership、runtime session facade、same-session lane scheduling、timeline/stream 和 cancellation/retry 边界。
- 落实 `architecture/request-run.md` 的 RequestRun version/CAS、queued/executing/terminal-pending 分类、retry lineage、cancel terminal visibility 和 terminal durable commit 不变量。
- 落实 `architecture/runtime-recovery.md` 的 local startup recovery、scheduler rebuild、claim/takeover、pending capability replay guard 和 recovery failed terminal path。
- 落实 `architecture/core-contracts.md` 的 `RuntimeCommandPort`、`RuntimeSessionPort.streamEvents`、`RuntimeSessionPort.getActiveRun`、`AgentConstructor`、`AgentRunStatePort`、runtime-owned run state write service、lane snapshot query 和 gateway composite write 调用边界。
- 落实 `architecture/conversation-process-history.md` 的声明式 timeline persistence policy、append-before-publish 顺序和 runtime session facade。调用中/最终答案 `LLM_CONTENT_DELTA` 与全部 `CAPABILITY_RESULT_DELTA` 保持 live-only；completed Tool-round `LLM_CONTENT_DELTA`、`CAPABILITY_STARTED` 与 `CAPABILITY_COMPLETED` 只在合法引用 shape 下持久化，不得携带可恢复正文；ordinary completion 的 result body 副本被 persistence policy 拒绝（ref-only Tool completion）。受治理 `TOOL_STRUCTURED_DELTA` 由 runtime-owned accumulator 按 `(runId, toolCallId)` 聚合为有界的过渡 presentation snapshot；普通完成结果在 canonical `CAPABILITY_RESULT` Message 成功写入后由 runtime 私有 flush，Core 不持有公开 flush 命令。`completed=true` 的最后累计 thinking 仍先 append canonical row。
- structured-delta accumulator 每 run 最多 64 groups、每 group 最多 256 events、source payload 最多 49,000 UTF-8 bytes；容量压力触发有界 flush，不建立无界 queue。direct flush、`finishRun` fallback 和 Workflow `NODE_COMPLETED` settled product 在 gateway 前复用同一 timeline normalizer，保证 `JSON.stringify(inlinePayload)` 的 UTF-8 bytes 不超过 49,000；TEXT、STREAM_DSL、PIU object/array 裁剪保持 shape 并设置 `truncated=true`。该标记只进入 safe stream/history presentation，不改变 request terminal、degradation/completion limitation 或 Context；真实 append failure 不吞掉。
- `RuntimeSessionPort.listEvents` 必须先校验 trusted owner、Agent、session 和 current run 或 copied-run snapshot status，再返回 bounded runtime-safe page；任意 scope mismatch、损坏 row 或 gateway failure 不得伪装为 AVAILABLE empty。
- `RuntimeSessionPort.resolveProcessMessages` 是 server-only bounded resolver：以 trusted identity/session/request/run 和 1–1000 个去重 message ids 查询 `SessionMessage`，legacy 模式只返回至多 1000 条完整候选；它不注册 Web route、不返回 Record、不新增 Gateway port。任何 scope/type/tool mismatch 缺项，候选溢出安全失败。
- 落实 session fork 边界：`RuntimeSessionPort.forkFromMessage` / `forkFromRequest` 是唯一用户可见 fork 编排入口，runtime 负责 source session/anchor 校验、prefix resource preflight、safe child message/event projection、child-owned identity remap、execution-bound promotion、child active context selector 调用和 gateway fork composite write。identity remap 覆盖 child `messageId`/`sessionId`/`requestId`，以及 source message 存在 `runId` 时新铸造的 child-scoped run anchor；source 无 `runId` 的 message 不获得 anchor。每个 copied display run 的 durable events 被物化为 child-owned `FORK_SNAPSHOT`，但 snapshot run anchor 不是 RequestRun，stream/recovery/cancel/retry/edit/active-run 必须忽略。
- fork preflight 必须对 ref-bearing process event 校验 copied-prefix membership、request/run/message type 与 `toolCallId`，再通过现有 source-to-child message map 写入 child `messageId`。缺失、歧义、跨 cutoff 或损坏引用在 composite 前失败；不得 scrub 引用后继续，也不得在 snapshot/diagnostic 中保留 source id。
- 拥有 `RuntimeSessionPort.streamEvents` 的 replay/live-tail 分支：显式 `lastSeenSequence` 执行 replay-then-live，省略 cursor 的 session stream 执行 no-cursor live-tail，`requestId/runId` 只作为 filter。
- Request Execution Stream 仍是 runtime-owned timeline/status projection；跨会话 Activity 只由 app-composed `RuntimeSessionActivityPort` facade 暴露 `agent-session` 投影，不进入 `RuntimeSessionPort.streamEvents(...)`、runtime cursor/replay、scheduler 或 terminal state machine。
- 消费 runtime-owned risk policy evaluator contract：在 capability invocation、sandbox 动态执行和 authorization pending input 恢复前消费 `RiskPolicyEvaluationInput -> RiskPolicyDecision`，创建或恢复当前 run scoped authorization pending input，写入必要的 timeline-only `POLICY_APPLIED`，并把 `DENY`、`DEGRADED`、`POLICY_FAILED` 映射为 safe stopped path。
- runtime 拥有 pending input active lookup、deadline decision、timeout resolution 和 answer resolve idempotency。默认 accepted deadline 是创建后 30 分钟；显式 deadline 必须晚于创建时刻且不晚于 24 小时，客户端、模型、channel metadata 和 fact query 都不能覆盖 policy。runtime 只通过 Agent-scoped `listUnresolvedPendingInputTimeoutFacts(...)` 读取 future/due `PENDING` 与 terminal 未提交的 `TIMED_OUT`，用自己的 clock 判断 due，并保证同一 run 只有一个 active pending、同一 answer command 只恢复一次、late answer/timeout answer/terminal answer被安全拒绝，以及 timeout 不会伪造 approval 或答案。
- timeout processor 每个 runtime instance 只有一个 processing flow和一只指向当前最早 deadline 的 timer；新建更早 pending input会唤醒并重排 timer。健康且最早 deadline 尚未来临时不轮询；每批最多处理 100 条，批间继续有界 keyset scan。startup recovery 完成后、readiness 前执行首次 recovery；单条或依赖失败使用 `1s..30s` 有界退避并继续其他候选，已为 `TIMED_OUT` 但 event/terminal 未完成的 fact 幂等收敛为 canonical `USER_INPUT_TIMEOUT`。`producerRef.kind === 'WORKFLOW_NODE'` 的 pending input 超时 resume 原 run（`resumePendingInputTimeout` 复用 `resumePendingRun` 的 checkpoint 加载和 recovery context 重建，通过 `attachWorkflowPendingTimeoutResume` 不设 `answers` 字段，re-queue 使用 `enqueueWork` 非阻塞，设置 `routingConstraints.targetRecipe` 为 `pending.producerRef.recipeName`），由 workflow engine handler 决定终态（`WORKFLOW_NODE_TIMEOUT` 无 exception 或 `COMPLETED` 有 exception）；checkpoint 不可用时 fallback 到直接终态化 `FAILED/PENDING_INPUT_TIMEOUT`。`producerRef.kind !== 'WORKFLOW_NODE'`（`LIFECYCLE_HOOK`、`CAPABILITY_INVOCATION`）的超时保持直接终态化 `FAILED/PENDING_INPUT_TIMEOUT`。`USER_INPUT_TIMEOUT` 事件在 resume 或终态化前发布。timeout terminalization 跳过会再次 PEND 的 terminal hook（仅对直接终态化路径），runtime close停止新 flow；完整时序见 `architecture/pending-input-lifecycle.md`。

## 最小内核职责

- 通过 runtime session facade 为 Web create/list/conversation/require/delete session 提供唯一入口，并在内部解析 trusted Agent Scope 后调用 `agent-session`。
- 通过 runtime session facade 为 Web message-anchor/request-anchor fork 提供唯一入口；request-anchor fork 只把 completed live assistant response 的 request/root message id 解析为 durable assistant message，然后复用 message-anchor fork。fork 执行内对每个不同 source `runId` 铸造一个 child run anchor，保留 inherited turn 分组和既有 `runIds` 读取/分享语义，但不持久化 source-to-child run 映射。
- request acceptance 使用 `AgentAssemblyRegistry.active(agentId)` 固化 `agentId`、`agentVersion` 和 `agentAssemblyRef`；accepted 后使用固化 assembly facts。
- `SubmitRequestCommand.sessionId` 可省略；省略时 runtime/session 会为该 submit 创建新 session。child Agent invocation 通过 `agentId/agentVersion`、`parentSessionId`、`parentRunId`、`parentRequestId` 和 `priority` 形成受信父子执行事实，不能从 capability 参数或模型输出覆盖 owner scope。
- request acceptance 只原样携带 typed `routingConstraints` 和 runtime-owned `acceptedInputText` 到 accepted `RequestContext`；runtime 不解析 `targetSkill`、provider、model profile、policy regex 或业务处理路径。
- attachment intake is runtime-owned: runtime accepts multipart attachment input before request acceptance, turns it into authoritative `RequestAttachment` facts via attachment runtime, and only forwards `attachmentIds` downstream; cleanup remains a separate capability.
- submit acceptance 将 durable run 放入 queued/scheduler path；scheduler 在 lane clear 且没有 terminal-pending run 时 dispatch queued work。
- dispatcher 启动前使用 RequestRun version CAS 将 queued run 推进到 `EXECUTING`，CAS 失败不得调用 Agent。
- cancel command 由 runtime 校验 latest request、cancelable state 和 idempotency key，并通过 terminal commit 产生用户可见 canceled terminal fact。
- retry command 由 runtime 校验 latest terminal committed request，创建同一 `requestId` 的新 attempt，触发 source attachment revalidation、visibility replacement 和 scheduler enqueue。
- 普通 submit 完成 acceptance facts 持久化并发布 `REQUEST_ACCEPTED` 后，runtime 以 command input 触发 fire-and-forget session title generation；title 失败不得回滚 acceptance、阻塞 scheduler 或改变 request terminal 结果。retry/edit 不触发该自动标题路径，是否跳过空白、slash command、已有标题或 manual title 由 session owner 决定。
- edit command 先以 trusted owner+agent+session scope 读取 lane snapshot，执行 expected-latest 与 idempotency semantic 校验，并在内部 command 携带 attachment ids 时重新校验 attachment authority；接受后创建新的 request/run/context、追加新的 USER message、保存 checkpoint 和 `REQUEST_ACCEPTED`，再通过 canonical lane replacement 使旧执行收敛到 `SUPERSEDED` 并把新 work 入队。既有 message/run/timeline facts 保持 append-only，默认可见历史由 replacement projection 决定。
- `RuntimeCommandPort.recordInputGuardBlock` 是输入护栏拦截轮的持久化入口，与 OUTPUT 护栏使用的 `hideRunMessages` 对称：`hideRunMessages` 隐藏已有 run 的 assistant 消息为 `visible=false`（`VisibilityReason="GUARD_BLOCKED"`），`recordInputGuardBlock` 记录无 run 的输入拦截轮。实现内部校验 identity scope（owner/Agent/session 一致，fail-closed），经 `SessionMessageStoreGateway.appendSessionMessage` 写入用户输入消息（`role=USER`、`visible=true`、`metadata.modelVisibility.excluded=true`、`metadata.guardPhase=INPUT_GUARD`）与拒答消息（`role=ASSISTANT`、content 为 guardrail 透传的 `refusalMessage`、`visible=true`、`metadata.modelVisibility.excluded=true`、`metadata.guardReason=INPUT_VIOLATION`），共享同一 `requestId`、无 `runId`；按 `idempotencyKey` 幂等不复制消息对。不调用 `runtime.submit`、不创建 run、不产生 terminal timeline event、不新增 message role/stream event type/gateway port/数据库表。`metadata.modelVisibility` 是 `SessionMessage.metadata` 的 additive typed extension（owner 为 `agent-contracts/session`），与 `visible` 字段解耦：`visible=true` 使 conversation 接口返回该轮供页面渲染，`metadata.modelVisibility.excluded=true` 使 context assembly 在后续轮次排除它不进 model context。
- 当前 edit latest preflight 是 lane snapshot 读取后的 runtime 校验，不是数据库内单一原子 compare-and-replace；当前 edit context locale 也固定为 `zh-CN`。这两个实现限制必须继续作为已知偏差，不得在 channel 或 frontend 文档中声明并发线性化或 locale 透传已经成立。
- retry/edit 在旧 run 进入 `SUPERSEDED` 后，runtime 必须调用 `ConversationAnnotationStoreGateway.deleteAnnotationsByRun` 清理旧 run 标注；清理失败时 retry/edit 必须失败，避免留下用户不可见的收藏或情感标注。
- local startup recovery 在 scheduler dispatch 新 work 前使用 app-composed `recoveryAgentId` 扫描该 Agent 下所有 owners 的 durable recoverable runs。accepted/queued/planning/executing 统一通过 record-derived Agent+Owner Scope、run version 和 lease 执行 claim-before-rebuild，只有 claim 返回 `UPDATED` 才使用最新 record重建 scheduler work或继续 executing recovery；terminal pending 只做既有幂等 reconciliation。不安全恢复进入 recovery failed terminal path，缺少可信 recovery Agent Scope 时 fail closed。
- pending capability recovery 先复用 persisted result；无法复用时必须基于 `CapabilityReplayPolicy` 和 stable replay key 决定是否可重放。
- runtime 只在 descriptor 允许安全重放时生成并传递 `CapabilityInvocationRequest.idempotencyKey`；不允许重放时必须在调用 capability 前 fail closed，而不是把 replay 判定下放给 provider。
- runtime 只消费冻结后的 lifecycle hook registration / definition / AgentAssembly activation snapshot；hook code registration 和 canonical hook object validation 属于 `agent-app` startup composition，hook package 扫描、manifest 校验和目录路径治理不属于产品路径，也不是 runtime 请求主路径职责。
- runtime 拥有 Agent policy registry/resolver implementation。Registry 是不同 policy shape 的统一容器，只按 accepted Agent scope、`agentAssemblyRef`、`policyPointId`、`pluginId` 和 `policyId` 保存 executable；resolver 按 accepted Agent scope 和 `policyPointId` 查询当前 AgentAssembly 激活的 policy executable，未激活时返回 undefined。Runtime 不规定所有 policy 的输入输出形状，也不执行 policy point 业务逻辑；具体 policy point owner 通过 typed adapter 执行。
- Policy materialization 发生在 startup/assembly 阶段：app composition 提供已校验的 plugin policy contributions，Agent assembly compiler 提供 implementation-free `AgentAssembly.policies` activation facts，runtime policy registry 将 default executable 或 `configure(config)` 产出的 assembly-specific executable 绑定到 `agentAssemblyRef + policyPointId + pluginId + policyId`。Resolver 必须校验请求携带的 `agentId`、`agentVersion`、`agentAssemblyRef` 与已冻结 assembly facts 一致，再返回对应 executable。
- Resolver 查询只有两种运行态结果：resolved executable 或 undefined。undefined 表示 accepted Agent 未激活该 policy point，调用方使用自身默认逻辑；invalid activation、missing executable、reserved/unknown point、duplicate enabled activation、invalid config 或 shape mismatch 不得作为运行态 unavailable 状态返回，必须在 startup/readiness 阶段 fail closed。
- 当前开放 policy point 只有 `agentRoutingPolicy`，其 owner 是 `agent-core`。`restrictedOperationPolicy`、`modelSelectionPolicy`、`modelFallbackPolicy` 和 `contextWindowPolicy` 保留为 reserved inventory，不开放插件执行。activation 指向不存在、未开放或 shape 非法 policy 时应在 Agent assembly/startup 阶段 fail closed，不作为运行期 unavailable 状态保留。
- runtime 实现 `AgentRunStatePort`，用 trusted RequestRun/RequestContext 补齐 owner/agent/session/request/run/timestamp 坐标，负责执行期 timeline event、message append 和 checkpoint save。
- runtime 接受 canonical `AskUserQuestion` 的 `QUESTION` answer 后，必须先通过现有 message owner 为 durable `producerRef.toolCallId` 幂等写入恰好一个可见 `CAPABILITY_RESULT`，再通过现有 run-state event publisher 发布同坐标的 live-only `CAPABILITY_RESULT_DELTA`，最后继续原 run。message append 失败时不得发布回答结果或继续缺少 durable result 的 producer；相同 answer replay、timeout 和 cancel 不得重复 materialize 或合成回答。live subscriber 缺失不阻塞 continuation，恢复由 durable conversation result 承担，runtime 不等待浏览器 ack、不把该 event 写入 timeline，也不改变 `lastSeenSequence`。startup recovery 遇到当前 run 仍拥有 active pending input 时必须保留暂停状态，不把该 run 当作可立即继续的 executing work。
- runtime 是 lifecycle hook executor owner：它基于冻结的 hook activation snapshot 计算 observe/impact 分组、并行 observe 组 timeout、串行 impact order 和有效 mutation reduction；它校验 cross-effect-group order target 并 fail closed，observe-only mutation 不产生 mutationSummary；它不重新扫描 hook source，也不把 hook executor 下沉到 core/model/context/capability。具体执行语义如下：
  - **执行策略从 effects 派生**：effects 恰好只有 `OBSERVE` 的 hook 进入 `OBSERVE_PARALLEL` group；包含 `TRANSFORM` 或 `CONTROL` 的 hook 进入 `SERIAL_IMPACT` group，即使同时声明 `OBSERVE`。
  - **Observe group 有界并行**：每个 observe-only hook 使用 resolved `timeoutMs`；observe group 使用明确的 group timeout，默认不超过该 stage 中最长 resolved hook timeout；超时后未完成的 observe invocation 记录 `TIMEOUT` 证据，主流程继续。observe-only hook 的失败、超时、非法控制输出只产生 `HOOK_INVOKED` 和观测降级，不写 lifecycle-changing evidence，不改变 effective boundary。
  - **Serial impact 稳定排序**：`SYSTEM` group 先于 `CUSTOM` group；`SYSTEM` group 按 framework-owned definition 的 explicit `order.priority` 排序（lower value runs earlier），`hookId` 兜底；`CUSTOM` group 构建同 stage impact hook graph，把 `order.before` / `order.after` 作为 graph constraints，stable topological sort comparator 为 `(priority if present else declarationOrdinal, declarationOrdinal, hookId)`。Runtime 和 assembly compiler MUST reject unknown order targets、cross-kind targets、cross-effect-group targets、targets not effective in the same stage、cycles 和 contradictory constraints。
  - **Outcome 解释**：`PASS` 允许合法 mutation 被归约进 effective boundary；`SKIP` 继续，不得携带 mutation 或 pending intent；`DENY` 停止后续 impact hook 和 protected operation，进入 policy-denied safe failure path；`BLOCK` 停止，进入 blocked/precondition safe failure path；`PEND` 停止，创建 runtime-owned pending input。`DENY` / `BLOCK` / `PEND` 与 mutation 同时出现时以控制结果为准，忽略 mutation。
  - **PEND stage 限制**：`PEND` 只允许在 `BEFORE_MODEL_INVOKE`、`BEFORE_CAPABILITY_INVOKE` 和 `BEFORE_AGENT_TERMINAL`；其他 stage 返回 `PEND` 按 `failureMode` 处理。runtime executor 在返回 `PEND` interruption 前必须先创建 pending input 和 durable resume coordinates；创建失败时 fail closed。
  - **Failure mode**：`CONTINUE` 记录失败观测事实后继续主流程；`FAIL` 记录失败观测事实后终止主流程。`SYSTEM` hook 必须 `failureMode=FAIL`。observe-only hook 超时、抛错或返回非法结果时 MUST 记录观测降级事实并继续主流程，不使用 `failureMode` 改变主流程。
  - **Recovery 重执行**：runtime 从保存的 recoverable lifecycle coordinate 重新接入。恢复坐标之前已完成的 stage 不回放。恢复落点的 protected operation 尚未完成时，该 stage 的 enabled hooks 使用 frozen hook snapshot 重新执行。`TRANSFORM` / `CONTROL` hook result 从恢复后的 stage boundary 重新计算，runtime 不缓存或重放之前返回的 mutation/control output。
- `RuntimeOwnedRunMessagePort.appendMessage` 是所有 `SessionMessage`（含 `CAPABILITY_RESULT`）落库的唯一咽喉点，接受 app composition 注入的可选 `LargeContentExternalizerPort`（contract 归 `agent-contracts/runtime`）。写入消息库前，若 externalizer 存在，则对超限 `CAPABILITY_RESULT` draft 调用 `externalize(draft, executionContext)` 把完整内容写到 execution workspace 的 `tool-results/<refId>.txt` 并改写 draft 为 `PERSISTED_PREVIEW`；未注入或已 frozen（`metadata.replacement` 存在）时直通。runtime 只依赖 port 契约，不直接依赖 `agent-context-engine`/`agent-capability`。
- runtime 拥有 Agent instance lifecycle/cache，通过 app-composed `AgentConstructor[]` 按 accepted `AgentAssembly.agentType` 构造 Agent，并按 `agentId + agentVersion + agentAssemblyRef` 作用域复用。
- runtime 提供 `SubagentExecutionPort` 的默认实现，但 contract 归 `agent-contracts/capability`。该实现使用 runtime `submit()` 创建 child session/run，固化目标 Agent scope，设置父子 session/run/request linkage 和低优先级调度，等待 child terminal stream，再把 terminal text 和 safe error 投影为 `SubagentExecutionResult`。Abort/timeout 必须取消 child run；child run 默认注入 no-nesting routing constraints（例如禁止 `Agent` capability、`allowSubagents=false`）。
- scheduler 必须同时满足 same-session lane serialisation 和全局并发上限；`RequestPriority` 仅影响 queued work 的选择顺序，不允许绕过 owner/agent/session lane、terminal-pending 阻塞、cancel/retry 或 terminal commit。
- runtime 实现 `ExecutionWorkspaceResolver.resolve(...)` 单入口。resolver 从 `runtimeWorkspaceRoot=<workspaceRoot>/execution`、`AgentAssembly.workspacePolicy`、trusted `agentId`、`tenantId`、`subjectId`、可选 `sessionId`、`runId` 和 `ExecutionDeploymentMode` 派生 internal `scopeBase`，并返回只包含 `workspaceDir`、`defaultCwd`、`roots[]` 的 `ExecutionWorkspaceView`。
- resolver 在 LOCAL deployment mode 下可消费 app-composed `sharedDataRoot=<workspaceRoot>/shared-data`，并在 runtime-facing workspace policy 含 `sharedData` root 时输出 logical `shared-data/` read-only root。`sharedDataRoot` 是 infrastructure fact，不进入 `AgentAssembly`、prompt、stream、safe error 或 audit。REMOTE/PaaS mode 遇到 `sharedData` root 必须 fail closed，不能省略该 root 后继续运行，也不能把本地主机路径暴露成远端 root。
- runtime 不拥有 Skill acquisition business logic，但拥有 acquisition 的通用 execution evidence carrier：acquisition 作为普通 capability invocation 写入 timeline/checkpoint/message path，safe provider/skill/outcome facts 可诊断，同步/安装/索引和 catalog governance 仍归 capability/SkillHub source。
- `scope-key` 使用版本化 hash namespace、isolation mode、trusted agent scope 和 owner scope 派生；session isolation mode 额外包含 trusted `sessionId`。`run-key` 使用 trusted `runId` 派生。目录名不得包含 raw agent、tenant、subject、session 或 run identifier。
- `scopeBase`、`runtimeWorkspaceRoot` 和物理 roots 是 infrastructure-only facts，不能进入 prompt、tool result、safe error、stream payload 或 public audit。prompt-facing `workspaceDir` 固定为 logical `workspace/`。
- Upload/intake、quarantine 和 pre-acceptance attachment validation 不调用 execution workspace resolver；accepted 后才可按 accepted run view 将 validated attachment 迁移、链接或投影到 `workspace/` 或 governed system resource view。
- terminal commit 只通过 `RequestRunStoreGateway.commitTerminal` 完成复合事务，不把 terminal message、active context item 和 terminal timeline event 拆成多个 public store call。
- fork 不为 child run anchor 创建 RequestRun、runtime-origin timeline、checkpoint、pending input 或 lane queue 事实，不调用 Agent core/model/capability、不写 source timeline/checkpoint，也不修改 source messages 或 source active context；child-owned `FORK_SNAPSHOT` 仅是 event-history 读取事实，cancel/retry/edit/recovery/stream/activeRun 等 lifecycle 路径不得把 anchor 当作可操作 run。child active context v0 必须由 fork materialization 一次性初始化。
- capability invocation audit 的 authoritative carrier 是 runtime canonicalized lifecycle fact。runtime 必须把 capability started/rejected/completed 等 safe outcome 补齐 trusted owner/agent/run/session coordinates 后交给 observability；audit sink 成败不得反向改变 runtime lifecycle truth。
- runtime 只发布已持久化 terminal timeline facts 给 app-composed listeners；task trajectory build intent、trajectory projection、memory extraction 和 memory aging lifecycle 都在 `agent-memory` / app composition 边界之外异步执行，不属于 runtime state machine。
- runtime 只拥有 agent execution trajectory 中的 runtime-owned事实发布，不拥有 replay surface 选择权：首版 trajectory 中的 context budget、capability selection 和 sandbox completion 由 runtime 负责补齐 trusted run/session/request refs 与 persistence policy；structured trajectory log、audit、metrics 和 trace 仍由 observability 从统一 observation stream 投影。稳定 turn skeleton 与独立 visible-output runtime fact 未在首版实现。

## Subagent execution 子模块

Runtime 提供 `SubagentExecutionPort` 的默认实现，但 port contract 本身归 `agent-contracts/capability`。这样 Agent tool 的依赖指向 capability-owned contract，避免 `agent-capability` 导入 runtime subpath。

本地实现是 `RuntimeCommandPort.submit()` 之上的薄 lifecycle adapter。它按 `targetAgentId/targetAgentVersion` 解析 target assembly，从 target assembly runtime settings 派生 effective child timeout，用 parent 的 trusted owner scope、parent session/run/request linkage、空 attachments、locale、低优先级和 target Agent scope 提交新的 child session/run，然后通过 runtime session/timeline APIs 等待 child run terminal result。

Child Agent execution 使用 fresh context。child session 不包含 parent conversation history、active context、timeline、attachments 或 tool state。child run 仍记录 parent linkage，用于 diagnostics、traceability 和 scheduling；但 parent linkage 永远不授予覆盖 owner scope、workspace root、provider credential、Agent scope 或 capability policy 的权限。

Cancellation 和 timeout 是 runtime lifecycle concern。如果 parent tool call 被 abort 或 child timeout 到期，subagent execution implementation 必须通过 runtime control flow 取消 child run，并返回 safe canceled/timed-out result。除非 parent lifecycle 自身按 runtime 规则 canceled 或 failed，否则它不得把 parent run 标记为 terminal。

当 `parentRunId` 存在时，child run 必须始终从 `submit()` 收到 no-nesting safety constraints。Framework-injected `forbiddenCapabilityIds` 必须包含 Agent tool，`allowSubagents` 必须强制为 `false`；caller-provided routing constraints 不能移除这些限制。这是 runtime safety invariant，不是 Agent package setting。

Scheduler 只把 `RequestPriority` 视为 queue ordering。`LOW` child runs 与普通 run 共用 global concurrency pool，但 capacity 可用时必须让位给 `NORMAL` user work。Priority 永远不能绕过 same-session lane serialization、terminal-pending blocking、version CAS、recovery fencing、cancel/retry legality 或 terminal commit。

## Parameter extraction 子模块

Runtime 提供 `ParameterExtractionPort` 的默认实现，但 port contract 本身归 `agent-contracts/capability`，遵循与 `SubagentExecutionPort` 相同的分层模式，避免 `agent-capability` 导入 runtime subpath 或 `ModelInvocationService`。

实现包装 `ModelInvocationService.complete()`，从 accepted agent assembly 解析 model profile（`locale` 和 `modelProfileId` 从 context 和 profile 传入），执行单次 `complete()` 调用做参数提取（不走 loop、不重试），解析 JSON 参数结果。提参通过 `RunBoundModelInvocation` 自动产生 `MODEL_INVOCATION_STARTED`/`MODEL_INVOCATION_COMPLETED` timeline 事件。超时返回 `PARAMETER_EXTRACTION_TIMEOUT`，结果解析失败返回 `PARAMETER_EXTRACTION_FAILED`，均不暴露模型输出或 prompt。该实现由 `agent-app` composition 注入到 `toolDependencies.parameterExtraction`，供隐藏 `ApiCall` tool 消费。

## 替换边界

否。Runtime 是 request lifecycle owner。

## 验证关注点

- 不得导入 Web channel、platform gateway adapter、app composition、provider SDK 或 database driver。
- channel/core/context/capability 不得创建竞争性 request lifecycle state machine。
- terminal visible state 必须位于 durable commit boundary 之后。
- same-session dispatch、cancel/retry、local recovery 和 capability replay guard 不得被 channel/session/core/capability/gateway 复制。
- edit replacement、internal attachment revalidation 和普通 submit acceptance 后的非阻塞标题触发不得被 channel、session、frontend 或 gateway 复制；title 提取和 manual overwrite protection 仍归 session owner。
- supersede cleanup 对 conversation annotation 的调用边界必须保持 runtime-only：runtime 只触发 `deleteAnnotationsByRun`，不拥有其他标注业务语义。
- core 不得导入 gateway contract 来写 message；context engine 不得导入 runtime lifecycle contract 来读取 assembly facts。
- runtime 不得导入 `agent-core` 或 `agent-app` 来构造 Agent implementation。
- runtime 不得把 `routingConstraints` 解释为授权、routing decision、capability resolve、provider select 或 model select。
- runtime 不得把 `acceptedInputText` 解释为 prompt authority、authorization override 或 observability payload；它只是供 Agent 内部 routing policy 消费的 accepted request fact。
- AskUserQuestion answer 路径必须覆盖 durable-before-live ordering、幂等 replay、message append failure、无 subscriber、active-pending startup recovery、timeout/cancel 和 observability 不泄露回答正文。
- timeout lifecycle 必须覆盖默认/显式 deadline、无流量自然到期、较早 deadline 重排、100 条批次与 single-flight、future idle 不轮询、startup/incomplete recovery、单条失败隔离、有界退避、late answer、terminal hook skip 和 close 后不再处理。
- runtime 不得派生或消费 Session Activity；它只发布已提交 lifecycle facts供 `agent-session` 重新派生。
- runtime policy resolver 不得执行 routing、model selection、context selection 或 restricted-operation 判断；它只返回当前 accepted Agent scope 下已激活的 executable。
- session fork 不得复用 subagent execution、task tool、retry/edit replacement 或 async detach 路径；runtime 不得把 source run/timeline/checkpoint truth 带入 child。copied message 的 child run anchor 仅是新铸造的 durable 分组键，不是 source run truth 的复制或可解析 lineage。
- runtime 可以基于 child-run parent linkage 注入 no-nesting safety constraints，但不得把普通 user-provided `routingConstraints` 当作 Agent delegation authorization。Delegation target authorization 由 capability catalog/governance 和 Agent tool validation 完成。
- resolver 是 accepted-run port；缺少 trusted run facts 的调用必须 fail closed。
- runtime 不得从 terminal commit、recovery、scheduler 或 cancellation path 删除 `temp/` 或 `.nextagent` execution files。
- runtime 不得导入 `agent-memory` 或实现 task trajectory、memory extraction、memory aging、memory revival 的判断和写入逻辑。

## Capability 失败处置协作

本包持久化 accepted run、canonical Tool/result messages、checkpoint、timeline 和 terminal commit，并在 pause、resume 与 crash recovery 中原样保留 `agentTurnIndex`。它不解释 Capability 业务错误、不拥有自动 retry，也不决定 finalizing；`0..maxTurns-1` 与 `maxTurns` 的恢复语义、checkpoint 幂等坐标和禁止新增 phase/store 的边界见 `openspec/designs/architecture/capability-invocation-and-failure-disposition.md`。

## Public Exports

`@nextagent/agent-runtime`
