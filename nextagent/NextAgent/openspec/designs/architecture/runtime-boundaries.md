# Runtime 边界

## 核心结论

TS runtime 是 request lifecycle 的唯一 owner。Channel、session、core、context、model、capability 和 gateway 不得创建竞争性的 request lifecycle state machine。

最小 Agent 内核已经建立一条可运行主路径：Web/channel 将 submit、cancel、retry 和 session/history 操作转为 runtime-facing port 调用；runtime 解析 trusted Agent Scope，创建或校验 owner+agent scoped session，持久化 accepted RequestRun 和 root user message，把同一 `tenantId + subjectId + agentId + sessionId` 的 work 纳入 session lane，经过 queued/scheduler dispatch 后构造或复用带 runtime-owned `AgentRunStatePort` 的 Agent，调用 `Agent.execute(run, context, signal)`，并在 terminal durable-write boundary 后发布 channel-visible terminal stream event。

Runtime contract 主承载：

- runtime command：submit、cancel、retryLatest、editLatest、answerPendingInput。
- RequestRun：status、terminal result、latest request metadata、attempt/retry lineage、run version、claim/fencing、terminal commit state 和 conditional update refs。
- terminal commit：terminal message、terminal event、RequestRun terminal state 和 idempotent terminal commit result。
- canonical timeline：执行事实事件、sequence、replay 游标和 stream projection 来源。
- runtime session facade：Web create/list/conversation/require/delete/fork session 入口，负责 trusted Agent Scope resolution 后委托 `agent-session` 或协调 fork materialization。
- run state side effects：Agent core 只能通过 runtime-owned `AgentRunStatePort` 发布执行事实、追加执行期 session message 和保存 checkpoint；runtime 负责补齐 owner/agent/session/request/run/timestamp 坐标并调用 gateway composite write。`RunMessagePort.appendMessage` 是 session message 落库的唯一咽喉点，接受 app composition 注入的可选 `LargeContentExternalizerPort`（contract 归 `agent-contracts/runtime`）：写入消息库前对超限 `CAPABILITY_RESULT` draft 同步 externalize 到 execution workspace 文件并改写为 `PERSISTED_PREVIEW`；未注入或已 frozen 时直通。runtime 只依赖 port 契约，不直接依赖 context-engine/capability implementation。
- structured presentation：runtime-owned accumulator 以 `(runId, toolCallId)` 隔离受治理 `TOOL_STRUCTURED_DELTA`，并对 group、event 和 source bytes 设置固定上限。普通完成结果只在 canonical `CAPABILITY_RESULT` Message 成功写入后由 runtime 私有 flush；Core 无公开 flush command。direct/fallback/Workflow completed-product timeline payload 在 local/remote gateway 前统一满足 `JSON.stringify` 后 UTF-8 不超过 49,000 bytes，发生裁剪时保形并标记 `truncated=true`；真实 append failure 继续传播。
- checkpoint：checkpoint payload、trigger reason、last sequence、active context version、flow variables 和 idempotency key。
- pending input：澄清、确认、授权、选择和人工接管统一进入 runtime-owned pending input。
- hook：lifecycle stage、effects-derived execution strategy、failure mode、outcome、mutation 和 invocation event。
- risk policy：runtime-facing evaluator input/output、authorization intent、timeline-only `POLICY_APPLIED` 和 fail-closed outcome consumption。

## Sandbox 执行边界

`agent-platform-gateway-local` 在 LOCAL 模式保留与远端一致的受信 root layout、工作目录、清洗环境、超时、取消、输出限制和入口校验，但不以修改既有宿主资源的 mode、ACL、所有权或只读属性模拟强隔离。REMOTE/PaaS 的文件系统隔离由容器或 Pod 的 root mapping、只读挂载和 deny-by-default 策略提供。直接执行的授权脚本若只缺 execute 位，只能在当前运行的 sandbox temp 根创建并执行一次性临时副本；该清理路径不得接触原始资源。

## 请求控制边界

`agent-channel-web` 接收用户操作后只能转换为 runtime command 或 runtime session facade 调用，不拥有 lifecycle state。Runtime 根据 session lane、latest-request、owner scope、agent scope 和 run version 判断 command 是否可接受。

最小内核 submit 规则：

- convenience submit 无 `sessionId` 时，runtime session facade 创建 owner+agent scoped session。
- session delete 通过 runtime session facade 进入；runtime 解析 trusted Agent Scope 后把删除委托给 session domain。若存在非 terminal run，删除必须以 safe conflict fail closed，且不得把删除转译为隐式 cancel。
- submit 携带 `sessionId` 时，runtime 必须按 trusted owner scope 和 trusted Agent Scope require 已持久化 session。
- submit 必须携带非空 canonical `idempotencyKey`；缺失或空白 key 时，runtime 在创建 RequestRun、调度 work 或发布 facts 前安全拒绝。
- acceptance 阶段通过 `AgentAssemblyRegistry.active(agentId)` 固化 `agentId`、`agentVersion` 和 `agentAssemblyRef` 到 RequestRun 和 RequestContext；accepted 后 core、context、capability 和 gateway 查询不得重新按 active/default Agent 选择路径。
- 同 owner+agent+session lane 中可以存在多个 accepted/queued durable runs；scheduler 是 same-lane execution gate，默认同一 lane 同一时间最多一个 run 进入 `EXECUTING`。
- terminal-pending run 阻塞 same-lane dispatch，但不阻塞较新的 submit 入队；queued facts 必须来自 durable RequestRun，而不是 process-local queue。

稳定 command 语义：

- submit 创建新的 `requestId` 和 `runId`。
- retry 复用同一个 `requestId`，创建新的 `runId`。
- edit 创建新的 `requestId` 和新的 `runId`。
- cancel、retry、edit 都必须携带 trusted identity/session metadata、canonical action、非空 idempotency key，并通过 `expectedLatestRequestId` 表达 latest-request 乐观校验。
- cancel 只面向 latest cancelable run；command accepted 不等于用户可见 `REQUEST_CANCELED`，后者必须等 terminal commit 稳定后投影。
- retry 只面向 latest 且 terminal-committed 的 request；retry 保持同一 `requestId`，创建新的 attempt/run，accepted 后替换默认 history visibility 并重新进入 scheduler path。

## 会话派生边界

Session fork 是用户可见 session lifecycle 操作，不是 RequestRun execution、retry、detach、tool 或 subagent execution。Web channel 只能通过 runtime session facade 调用 `forkFromMessage` 或 `forkFromRequest`；runtime 校验 trusted owner scope、trusted Agent Scope、source session、anchor eligibility、resource limits 和 safe child message projection，然后把 child session/messages/active context/fork source/promotion facts 交给 gateway composite write。

Message-anchor fork 只接受已持久化、visible、非空、可由 conversation history 读取的 assistant message。Request-anchor fork 只是实时完成后的便利入口：runtime 按 source request/root message id 解析到唯一 durable completed assistant message 后，复用同一 message-anchor fork 路径。两条路径都不得让客户端传入 child session id、copied messages、active context refs、timeline、checkpoint、owner/agent 字段或 fork source metadata。

Fork materialization 复制 source session 从开头到 anchor 的 canonical durable message prefix，并在 child 内重写 message/session/request refs。运行状态 provider 对 session fork 提供统一准备、暂存和原子创建操作：provider boundary 只接收可信 owner scope、Agent Scope、source session、独立 message/request anchor、幂等键、fork attempt 和 prepare 清单对应的受预算 bytes，不接收完整 source prefix 或预构造 child records；系统根据可信 source 坐标读取 Working Memory provider 已持有的完整源事实，返回有界 ref 清单，NextAgent 通过可信 resolver 取得对应 bytes 后在数据本地产生完整 child 结果。无法通过规范 ref 安全解析的路径或未知 ref 失败；LOCAL 与外部 REMOTE AgentMemory 通过同一 contract 完整派生并原子返回，部署模式不改变派生语义或原子性，调用方不接触与历史长度相关的 materialization payload。source message 携带 `runId` 时，runtime 只在当次 fork 内把同一 source `runId` 映射为同一新铸造的 child-scoped run anchor，不同 source run 使用不同 anchor；fork 不复制 source `runId` 本身。child anchor 只是 durable message 的 turn 分组/读取键，不得等于 source `runId`，也不得反解 source run。source run identity 与映射关系、RequestRun、runtime-origin timeline、checkpoint、pending input、tool state、source invocation lineage、raw provider 字段和 parent active context 均不复制；需要保留的 durable process history 必须独立验证并使用 child identities 重映射为 persistence-only `FORK_SNAPSHOT`，不能保留 source timeline identity 或进入 child model context。含 execution-bound ref 的 copied content/metadata 必须先 promotion 成 owner+agent scoped、child 可访问的 durable content；无法 promotion 或无法安全重写时，fork 整体 fail closed，且 staged promotions 同步 abort。

## Timeline 和 Stream

执行组件只发布事实事件；runtime 维护 canonical timeline；channel 只投影 stream envelope。

- Runtime-origin canonical `RunTimelineEvent` 包含 eventId、sessionId、runId、requestId、requestContextId、sequence、type、inlinePayload、optional contentRef 和 createdAt。Persistence-only `FORK_SNAPSHOT` 省略 requestContextId/contentRef，只能通过 run event-history facade 读取，不参与 runtime lifecycle、stream、resume 或模型上下文。
- `RuntimeSessionPort.streamEvents` 使用 optional session-scoped `lastSeenSequence` 表达恢复游标。字段显式存在时 runtime 走 replay-then-live，返回 `sequence > lastSeenSequence` 且匹配 filter 的事件；显式 `lastSeenSequence=0` 保留从 session timeline 开头 replay 的语义。
- 省略 `lastSeenSequence` 且没有 `requestId/runId` filter 时，runtime 走 no-cursor session live-tail：订阅建立时确定当前 session tail boundary，不扫描、不 catch-up、不投影已有 timeline events，只交付 boundary 之后的新 canonical events。
- 省略 `lastSeenSequence` 却携带 `requestId/runId` filter 不是合法 bounded recovery；activeRun bootstrap、submit/retry/edit accepted-run recovery 必须用显式 `lastSeenSequence=0 + requestId/runId` 表达。
- `requestId`/`runId` 只作为过滤条件，不改变 session-scoped sequence ownership，不引入 run 内 sequence。
- SSE 和 WebSocket 使用等价的 runtime event stream projection；transport 选择来自 backend bootstrap projection 的 `transportKind`，不得由 frontend env、query、localStorage 或 runtime script injection 覆盖。
- 模型调用中的 partial delta 不作为长期可恢复事实；最后累计且 `completed=true` 的 `LLM_THINKING_DELTA` 是持久化完成态。其他 live-only delta 仍由 timeline replay、message/history refresh 和 read model 按各自稳定规则协作恢复。
- 普通 Capability 的 semantic result 始终由 `CAPABILITY_RESULT` Message 拥有。受治理 `TOOL_STRUCTURED_DELTA` 的 bounded timeline body 只是 Channel/Web live-history presentation snapshot，不进入 Context、terminal、limitation 或 fork/model authority；Workflow inner `NODE_COMPLETED` product 是独立的 Event-owned 封闭例外。
- terminal stream event 和 visible conversation history 只能在 terminal durable-write boundary 成功后对客户端可见。

## Checkpoint 和恢复

Checkpoint 是恢复锚点，不是业务事件替代品。`CheckpointPayload` 必须覆盖 checkpointId、sessionId、requestId、runId、requestContextId、runVersion、triggerReason、lastSequence、activeContextVersion、flowVariables、savedAt 和 idempotencyKey。

恢复规则：

- Runtime 使用 run version、claim/fencing 和 CAS result 防止重复接管。
- Agent-bound runtime 启动后必须在 scheduler dispatch 新 work 前执行 bounded recovery pass；discovery 使用 app composition 注入的可信 `recoveryAgentId`，覆盖该 Agent 下所有 owners，并基于 durable RequestRun、checkpoint、message、timeline 和 terminal facts分类 queued、executing 与 terminal-pending runs。accepted/queued/planning/executing 只有取得 scoped version-CAS lease claim 后才能重建或继续；terminal pending 仍只走幂等 terminal reconciliation。
- Terminal commit 必须幂等，区分 committed、already committed、version conflict、not found。terminal commit 通过 selected Working Memory provider 的 composite write 在一个 provider-local atomic transaction 内完成 RequestRun terminal state、terminal assistant message、active context item 和 terminal timeline event 写入；channel-visible terminal event 只能在 commit 成功且 `terminalCommitState=COMMITTED` 后发布。Runtime 不得把这些工作事实拆到 Long-term Memory 或保留 SQLite provider，也不得引入跨 provider terminal transaction。
- Tool 不默认幂等；恢复到 pending capability/tool boundary 时，runtime 必须先基于 descriptor `CapabilityReplayPolicy`、persisted result 和 stable replay key 判断是否可以重放。
- 如果目标能力未声明可安全重放、缺少 stable replay key 或 recovery facts 不一致，恢复逻辑不得盲目重复调用，必须 fail closed 并进入 recovery failed terminal path。

Gateway public ports 是 async persistence boundary。当前 gateway-local 只有 SQLite local atomic persistence transaction，以一致性为先，不承诺事务中途 abort；runtime/core/model/capability/stream 慢边界接收并传播 `AbortSignal`，远程、长耗时或可取消的 Gateway cancellation 由后续 change 补齐。

## Execution Shared Data Root

LOCAL deployment mode can expose `<workspaceRoot>/shared-data/` as logical root `shared-data/` in accepted-run execution workspace views. This root is read-only, local-only and intended for public telecom diagnostic inputs. Runtime derives it only from app-composed trusted path facts and runtime-facing logical root policy; it never reads arbitrary `workspaceRoot` contents and never exposes `execution/`, `data/`, SQLite, logs or provider-private roots.

`shared-data/` does not participate in terminal commit, checkpoint, temp cleanup, generated Skill writes or tool-result externalization. Outputs must use `workspace/` or `temp/`. REMOTE/PaaS mode must fail closed if `sharedData` appears in policy because this contract does not define remote shared storage.

Accepted-run execution workspace view 也是 root-aware file tools 与 sandbox executables 的统一逻辑默认根。Runtime 只拥有可信 view 的派生与生命周期；`agent-capability` 的 `WorkspaceFilePort` 拥有文件路径解释和 enforcement。无已知 root 前缀的 Read/Write/Edit/Glob/Grep 路径与 Bash/Python 默认 cwd 指向同一 view 目标，`workspace/` 仍表示 durable root。该一致性不得把 `scopeBase`、scope key、`/work` 映射或宿主绝对路径投影到 Tool result、Web/stream、safe error 或日志。

## Request acceptance 后 Session domain 回调

ordinary submit acceptance 成功、session/run scope 固化并写出 `REQUEST_ACCEPTED` 后，runtime fire-and-forget 调用 `UserSessionPort.generateTitle`，使用本次 accepted command 的输入尝试确定性生成会话标题。该调用不阻塞 request acceptance、scheduler、streaming 或 terminal commit，不等待 terminal status，也不查询 conversation history 选择其他输入；retry 和 edit-resubmit acceptance 不触发此路径。失败只进入现有结构化诊断日志，不改变 request terminal outcome；日志内容仍必须服从仓库 redaction 和 diagnostic-safety 约束。

runtime 以可信 owner+Agent+session scope 维护 process-local resolved set：session owner 返回已生成、已有非空标题或 `titleSource === "manual"` 时，当前 runtime instance 不再尝试；blank、slash-prefixed、不安全、missing 或异常返回未 resolved，允许后续 ordinary submit acceptance 使用其 command input 再试。`isFirstRequest` 和 `firstUserText` 是现有 session command 字段名，不表示该调用点只在真实首个请求触发。session domain 方法仍负责 scope、覆盖保护、确定性提取、安全检查和持久化语义，runtime 不重写这些领域规则。

这类回调不引入 event bus、message queue 或 pub/sub 基础设施；runtime 通过 composition 持有的 `UserSessionPort` 实例直接调用。回调方法签名和语义归 `agent-contracts/session` 和 `agent-session` 拥有。

## Pending Input 和 Hook

模型、hook、policy、capability 或 runtime 需要人参与时，必须通过同一个 pending input boundary。Pending input 只承载 kind、questions、answers、timeoutAt、status 和恢复锚点；客户端 answer 或持久化对象不得引入 origin、timeout behavior、answer schema、audit linkage、run version、step id、identity、idempotency key 或 model-formatted answer 字段。

统一 pending boundary 下的稳定种类是 `QUESTION`、`CONFIRMATION`、`AUTHORIZATION` 和 `HUMAN_HANDOFF`。`QUESTION` 支持 text、single-select、multi-select 和 custom answer；`CONFIRMATION` 只接受 approve/reject，且不能冒充受保护操作授权；`AUTHORIZATION` 只绑定当前 run 内一个受限操作；`HUMAN_HANDOFF` 只接受 final answer 或 resume instruction。所有类型都复用同一个 answer ingress、同一个恢复锚点和同一个 lane blocking 规则，不创建平行 pending facade 或平行恢复入口。

同一 run 同一时间只允许一个 active pending input。pending 在可恢复 checkpoint 成功后才可见；same-session submit 在 active pending 存在时必须被拒绝或继续阻塞。answer resolve 必须是 runtime-owned idempotent transition：同一 answer command replay 只能恢复一次，late answer、timeout 后 answer 或 terminal run answer 都必须安全拒绝。

Lifecycle hook 的稳定 owner 规则是：runtime 拥有 vocabulary、结果解释、pending handoff、timeline-only lifecycle outcome evidence 和 executor reduction truth；真实 stage trigger 位置由最接近 protected operation 的模块 owner 承担。observe-only hook 以并行组执行但不拥有 request truth；声明 `TRANSFORM` 或 `CONTROL` 的 hook 必须串行归约，并在 mutation 生效后再进入后续 impact hook 或 protected operation。observe-only hook 与 impact hook 之间的 `order.before` / `order.after` 约束必须在装配期 fail closed；observe-only hook 之间 order 约束只用于 diagnostics evidence，不影响并行执行顺序。

Hook 的 canonical outcome 是 `PASS`、`SKIP`、`DENY`、`BLOCK` 和 `PEND`。`PASS` 允许合法 mutation 被归约；`SKIP` 表示 hook 已进入但不适用，且不得携带 mutation 或 pending intent；`DENY`、`BLOCK` 和 `PEND` 只对声明 `CONTROL` 的 hook 合法。若控制结果与 mutation 同时出现，runtime 以控制结果为准，不应用 mutation。`PEND` 只允许在 `BEFORE_MODEL_INVOKE`、`BEFORE_CAPABILITY_INVOKE` 和 `BEFORE_AGENT_TERMINAL` 使用；其他 stage 返回 `PEND` 按 `failureMode` 处理。

每个 stage 的执行顺序是：resolve frozen snapshot → 用 stage entry boundary 启动 observe-only hook invocations → 立即执行 serial impact group → 等待 observe-only group settle 或 group timeout 后返回 stage。observe-only hook 看到的是 stage entry boundary，看不到 serial impact group 产生的 mutation。observe group timeout 默认不超过该 stage 中最长 resolved hook timeout；超时后未完成的 observe invocation 记录 `TIMEOUT` 证据，主流程继续。

9 个 stage 的 trigger ownership 按 protected operation 分配：

- `BEFORE_REQUEST_ACCEPT` 由 `agent-runtime` 在 request acceptance 边界触发；
- `BEFORE_PLANNING` 由 `agent-core` 在 agent loop 内每个 planning turn 调用模型前触发，位置在请求/技能路由和 routing constraints 已解析、当前 planning-turn 输入已确定之后，context assembly / model request construction 之前；boundary 包含 round index、step id、effective step limits 和进入该 planning turn 前已累积的 request-local capability effects；
- `BEFORE_MODEL_INVOKE` 由 `agent-model` 在每次 provider invocation 前、`ModelInvocationRequest` 已构造后触发；agent loop、fallback、context/prompt、评估等所有模型调用路径不得绕过该边界；
- `AFTER_MODEL_RESULT` 由 `agent-model` 在 provider result normalization 后、返回 caller 前触发；成功完成的 boundary MUST 包含从 concrete provider invocation 开始到成功 terminal result 的非负整数毫秒 `modelE2ELatencyMs`，并在系统观察到首个非空 content delta、非空 reasoning delta、tool call delta 或成功 terminal result 中首个非空 content、非空 reasoning、至少一个 tool call 时包含同源且不大于总时延的 `firstContentLatencyMs`；成功结果未携带上述任一反馈时省略 `firstContentLatencyMs`。成功 `ModelFinalResult` 携带 `usage` 时 boundary MUST 原样投影其已提供的 `inputTokens`、`outputTokens` 和 `totalTokens`，未提供字段保持缺失；未携带 `usage` 时省略该字段，不估算或补齐。这些诊断字段是 observe-only boundary facts，不参与 `AFTER_MODEL_RESULT` mutation；模型调用失败时不合成该 boundary。
- `BEFORE_CAPABILITY_INVOKE` 由 `agent-core` tool loop 在 tool call 已解析为 capability id、descriptor / routing constraints / subagent guard 已通过、`CapabilityInvocationRequest` 已构造之后、`CAPABILITY_BEFORE_CALL` checkpoint 和 `capabilityInvocation.invoke(...)` 之前触发；
- `AFTER_CAPABILITY_RESULT` 由 `agent-core` tool loop 在 `capabilityInvocation.invoke(...)` 返回 raw result 且 basic envelope validation 通过之后、effective result downstream consumption 之前触发；
- `BEFORE_CONTEXT_COMPACT` / `AFTER_CONTEXT_COMPACT` 由 `agent-context-engine` 在真实 compaction 边界触发；`BEFORE_CONTEXT_COMPACT` 在 summary generation 消费 effective input 前，`AFTER_CONTEXT_COMPACT` 在 summary draft 生成并通过校验后、`commitCompaction` 持久化前；skipped/no-op compaction 不触发 after hook；
- `BEFORE_AGENT_TERMINAL` 由 `agent-core` 在 agent loop 判断正常退出、无待执行 model tool calls、最终 content 已形成之后、final-content user-visible event 发送之前触发。

Runtime 还拥有 agent execution trajectory 中 runtime-owned事实的发布边界。首版已落地的 runtime-owned trajectory 输入是 context assembly、capability selection 和 sandbox execution；它们由 runtime listener 或 runtime diagnostic log-derived observation 补齐 `requestRunId`、`requestId`、`requestContextId`、时间和 persistence policy。runtime 不得为了 trajectory replay 直接写 structured log、audit sink、metrics registry 或 trace exporter，也不得让 `traceId`、`spanId` 成为 replay 主键。稳定 `AGENT_TURN_*` fact 或独立 `STREAM_VISIBLE_OUTPUT_STARTED` 若未来需要进入 runtime-owned vocabulary，必须由后续 owning change 显式引入。

依赖方向约束：`agent-runtime` 不得导入 `agent-core`、`agent-model`、`agent-context-engine`、`agent-capability` implementation package。`agent-model` 和 `agent-context-engine` MAY import `agent-contracts/runtime` only for lifecycle hook stage invocation symbols（stage vocabulary、hook boundary/mutation/result types、`LifecycleHookInvocationPort` / request / result types、共享 lifecycle hook control-interruption signal）；MUST NOT import `agent-runtime` implementation，MUST NOT consume `AgentRunStatePort`、checkpoint writer/query types、timeline writer/query types、terminal commit types、runtime command/session ports、RequestRun store facts。`agent-app` composition 负责把 `agent-runtime` hook executor implementation 通过 `LifecycleHookInvocationPort` 注入给 `agent-core`、`agent-model` 和 `agent-context-engine`。

Control-interruption signal 传播：stage owner 收到 `INTERRUPT` 结果后必须停止 protected operation，把共享 control-interruption signal 原样传播到 request lifecycle owner。`agent-model` 在 `BEFORE_MODEL_INVOKE` 返回 `INTERRUPT` 时 MUST NOT call provider SDK，MUST throw signal unchanged；`ModelInvocationService.complete(...)` / `stream(...)` 不新增 `PEND` result variant。Model caller（agent-core、fallback consumer、evaluation consumer）MUST rethrow signal to runtime lifecycle boundary，MUST NOT 把 signal 包装成 model safe error、provider error、fallback miss 或普通 exception。

Recovery 语义：runtime 从保存的 recoverable lifecycle coordinate 重新接入。恢复坐标之前已完成的 stage 通过 checkpoint / lifecycle truth 保留效果但不回放。恢复落点的 protected operation 尚未完成时，该 stage 的 enabled hooks 使用 frozen hook snapshot 重新执行。`TRANSFORM` / `CONTROL` hook result 从恢复后的 stage boundary 重新计算，runtime 不缓存或重放之前返回的 mutation/control output，也不为 impact hook result 提供 observe side-effect idempotency key。hook 作者如果依赖外部读取，必须自行通过 frozen config、版本化引用或幂等/确定性读取保证恢复重执行一致性。

Risk policy 不是 lifecycle hook，也不拥有独立 persistence plane。受限操作进入真实执行前，runtime 或 runtime-owned 受限执行边界必须先消费 runtime-owned `RiskPolicyEvaluator` contract。policy 只消费 trusted identity、owner/agent/run refs、restricted operation summary、sandbox readiness、idempotency/recovery summary 和可观测性状态等安全摘要，不消费 raw prompt、raw model output、raw tool args/result、raw attachment content、secret、credential、本地路径或完整 sandbox request。policy outcome 只能是 `ALLOW`、`DENY`、`REQUIRE_AUTHORIZATION`、`DEGRADED` 或 `POLICY_FAILED`；运行时对 `DENY`、`DEGRADED` 和 `POLICY_FAILED` fail closed，对 `REQUIRE_AUTHORIZATION` 创建当前 run scoped authorization pending input，并在 scope 匹配的 approve answer 后派生一次性执行许可。

Authorization scope 是 pending input durable fact 的一部分，而不是独立 authorization store。它只绑定当前 owner、当前 run 和目标 operation ref，不进入客户端 answer payload，不跨 run、跨 session 或长期复用。risk policy 改变执行路径时，runtime 写入 timeline-only `POLICY_APPLIED`；该 event 不进入用户可见 `StreamEventType`，只服务恢复、审计和诊断。

timeout 由 runtime 根据 durable pending facts 统一决策和解析。default timeout、显式 bounded timeout、due timeout scan 和 timeout resolution 都属于 runtime-owned lifecycle decision。timeout 永远不能自动批准：confirmation timeout 不是 approval，authorization timeout 不是授权，question/handoff timeout 不得伪造答案或完成结果。

## Capability Replay、冲突消费与审计输入

runtime 是 capability replay 和 invocation audit truth 的上游 owner。进入 capability 调用前，runtime 或 runtime-owned Agent loop 必须先消费 governed descriptor facts，而不是让 provider 自己判断 recovery 或冲突语义：

- 只有 descriptor `replayPolicy=IDEMPOTENT` 且当前场景存在稳定 replay anchor 时，runtime 才能生成 `CapabilityInvocationRequest.idempotencyKey` 并允许重放。
- 稳定 key 必须是 runtime-owned invocation anchor；provider 只消费它，不得自造 recovery flag、owner scope 或 agent scope。
- catalog `resolve()` 若因为同 scope conflict reject 或跨 scope shadow 后没有 executable winner，runtime/core 只能得到 safe not-found/conflict outcome，不得在 invocation path 重新选择 provider。

capability invocation audit 也沿 runtime-owned canonical lifecycle 进入 observability：executor/core 只发布 safe capability lifecycle facts，runtime 负责补齐 trusted owner/agent/session/request/run coordinates，并把它们作为 canonical event 或 authorized observation input 提交给 observability。capability executor、Agent Core 和 provider implementation 不得直接调用 `AuditEventWriter` 决定审计写入，也不得把 audit sink 成败反向影响 request terminal truth。

## 验证入口

- runtime command contract tests
- event vocabulary tests
- stream projection tests
- recovery contract tests
- terminal commit idempotency tests
- checkpoint payload tests
- pending input smoke tests

## Governed Business CLI Executables

The governed `clipc` command introduces a two-layer authorization boundary for business CLI commands:

1. **Bash Policy (model-visible)**: The Bash policy layer parses and authorizes the model-submitted command shape (`clipc query <handler> <api-path>` / `clipc subscribe ...`), rejects invalid forms, and treats `clipc` as the only network-capable Bash command exception. The model MUST NOT provide or override the executable path, endpoint, credential, environment variable, or arbitrary transport option.

2. **Sandbox Gateway (execution boundary)**: The restricted local sandbox resolves the `clipc` binary through a trusted executable locator supplied by app composition, normalizes the directory, verifies the resolved target exists as a regular file, and executes it with `shell: false` using the structured argument array. Missing locator, unknown executable, or path escape MUST fail closed. This locator is specific to `clipc` and MUST NOT create a runtime-configurable arbitrary executable registry.
