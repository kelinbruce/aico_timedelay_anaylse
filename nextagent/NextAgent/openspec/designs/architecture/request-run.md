# RequestRun 领域模型

## 核心结论

RequestRun 是一次请求执行尝试的 durable fact。`requestId` 是请求的 root user message id；retry 保持同一个 `requestId` 并创建新的 `runId`；edit 创建新的 `requestId`。`runId` 标识单次执行尝试，`attempt` 标识同一 request 的第几次执行，`requestContextId` 标识本次执行使用的上下文快照。

## 生命周期事实

RequestRun 至少承载：

- tenantId 和 subjectId
- sessionId
- requestId
- runId
- requestContextId
- agentId、agentVersion 和 agentAssemblyRef
- parentRunId 和 parentRequestId（仅 child Agent run 需要）
- priority（用于 scheduler queue ordering）
- status
- terminal result
- latest-request metadata
- run version
- claim/fencing refs
- created/updated timestamps

Channel、session、core、context、model、capability 和 gateway 不得创建竞争性的 request lifecycle state machine。

request acceptance 阶段必须从 trusted Agent Scope 解析 active assembly，并把 `agentId`、`agentVersion` 和 `agentAssemblyRef` 固化到 RequestRun 和 RequestContext。accepted 后 runtime、core、context、capability、gateway 查询不得重新按默认 Agent 或 active assembly 选择执行路径。

## Version、Claim 和 Fencing

Runtime 使用 run version 表达乐观并发控制，使用 claim/fencing 表达多实例接管约束。Gateway CAS result 必须区分 updated、version conflict、not found。PaaS 多实例启用时，RequestRun、checkpoint、pending input、timeline、terminal commit、lock/lease 和 version 必须作为共享权威状态处理。

dispatcher 只调度已持久化、assembly 已固化且未进入 terminal 的 accepted/queued run；启动前用 expected version 将同一 run 从 `QUEUED` CAS 推进到 `EXECUTING`，CAS 未更新时不得调用 Agent。同一 owner+agent+session lane 可以保留多个 durable queued runs，但 scheduler 必须保证同一 lane 同一时间最多一个 run 进入 terminal-writing execution path。

`RequestPriority` 只影响 queued work 的选择顺序。它不得绕过 same-session lane、terminal-pending 阻塞、owner/agent scope 隔离、cancel/retry 合法性、recovery claim/fencing 或 terminal commit boundary。Agent tool 发起的 child run 默认使用低优先级，避免 nested delegation 抢占普通用户请求。

## Parent/Child Agent Runs

Agent tool 发起的 child run 必须通过 runtime submit path 创建新 session/run，并记录 parent session/run/request linkage。父子关系只用于诊断、调度和 child result correlation；它不允许 child run 继承或覆盖 owner scope，也不允许 capability 参数指定 owner、workspace root、provider credential 或 runtime authority。

Child run 使用目标 Agent 的 trusted `agentId/agentVersion/agentAssemblyRef` 固化执行路径，并默认注入 no-nesting routing constraints，防止递归 Agent tool 调用。父 run 能收到 child terminal text/safe error 作为 capability result；child lifecycle、timeline、terminal commit 和 cancellation 仍由 runtime 独立拥有。

## Session Lane 和 Latest Request

`tenantId + subjectId + agentId + sessionId` 定义一个 session lane。Lane snapshot 是 gateway-owned durable facts 的读取结果，包含 latestRun、executingRun、queuedRuns 和 terminalPendingRun 等事实；它不得包含 `shouldQueue`、`shouldSupersede` 或 `shouldStartExecution` 等 decision 字段。

`ACCEPTED`、`QUEUED` 和 pre-execution run 属于 queued lane facts；`EXECUTING` 属于 executing lane fact；`terminalCommitState=PENDING/RETRYING` 属于 terminal-pending fact。Terminal-pending run 阻塞 same-lane dispatch 和 lane release，直到 terminal commit 达到 committed、already-committed、version-conflict 或 safe failure outcome。Later submit 可以进入 queued state，并按 replacement/supersession policy 处理 older work，但 supersession 和 cancel 都必须通过 terminal commit 形成唯一 terminal lifecycle event。

## Cancel 和 Retry

Cancel 只作用于 latest agent+owner-scoped cancelable request。`ACCEPTED`、`QUEUED` 和 `EXECUTING` latest run 可取消；`COMPLETED`、`FAILED`、`CANCELED` 和 `SUPERSEDED` terminal run 不可取消。Cancel accepted 只是 command acceptance；用户可见 canceled terminal 必须来自 committed `REQUEST_CANCELED` terminal fact。Late model 或 capability output 不得把 committed canceled run 改回 completed，也不得追加第二个 terminal lifecycle event。

Retry 只作用于 latest 且 terminal-committed 的 request。Retry 创建同一 `requestId` 下的新 `RequestRun` attempt，记录 `retryOfRunId` 或等价 previous-attempt link，并保留 source run 固化的 `agentId`、`agentVersion`、`agentAssemblyRef` 和 owner scope。Retry accepted/queued 后，默认 history visibility 隐藏 source attempt 的 assistant/capability output，但 source durable facts、timeline 和 authorized diagnostic visibility 必须保留。Retry model context 由 active context/view policy 决定，不得把被替换 attempt 的输出当作仍有效模型输入。

浏览器当前 attempt 投影是 Agent Web 拥有的默认展示选择，不回写后端 visibility。Retry acceptance 取得 HTTP 或权威 stream 确认的新 `runId` 后，Agent Web 以该 `runId` 作为该 request 的当前 attempt，在同一 root 内原子过滤 history envelope、history message、active live bucket 和 settled live bucket 的 assistant/process 事实，更新当前 display run 与 process-history target，并删除该 root 指向其他 run 的自动和显式 process-history target。当前轮次的 Think、工具步骤、阶段文字和 canonical assistant answer 只由当前 `runId` 的事实组成；其他 attempt 的过程或答案不参与当前 attempt 的合并、去重、完成判定或答案抑制。旧 attempt 的 process-history 缓存和后端可追溯事实保留，但不参与默认当前轮次投影。该过滤规则必须贯穿 live overlay、会话切换返回和 authoritative history reload，使三者对当前 `runId` 得出一致默认可见结果。分享页面继续读取创建分享时冻结的 snapshot，不复用普通会话的当前投影状态；fork child 的 Retry 只切换 child-owned attempt，前端动作的 session/root 作用域不得触达 parent。

## Recovery Classification

本地 runtime recovery 只能基于 durable RequestRun、checkpoint、message、timeline 和 terminal facts 分类 recoverable runs。Queued recovery 重新构造 scheduler work item，不 inline execute Agent；executing recovery 必须先 claim/fence，再按 checkpoint 和 persisted messages 重建 RequestContext；terminal recovery 只重试或 reconcile terminal commit boundary。

恢复无法证明安全时，必须 fail closed，通过 recovery failed / safe failed terminal path 收敛。Recovery failure 不是用户 cancel，也不是 replacement supersession；不得静默 drop work、mark success、重放非幂等 capability，或把 run 长期留在 `EXECUTING`。

## Terminal Commit

Terminal commit 是请求结果对用户可见前的 durable boundary。Terminal commit 必须同时处理 terminal message、terminal event、RequestRun terminal state 和 idempotent terminal commit result。

terminal commit 必须以一个 gateway composite transaction 完成 RequestRun terminal state、terminal assistant message、active context item 和 terminal timeline event 写入。terminal durable commit failure 不得发布用户可见 completed/failed terminal stream event；已进入 pending 时 runtime 必须尝试写入内部可诊断 failure，诊断更新失败时保留 pending 状态供后续恢复能力处理。

Terminal commit result 必须区分：

- committed
- already committed
- version conflict
- not found

## 与 Session 和 Timeline 的关系

Session/message/read model、active RequestRun、pending input 和 human handoff 事实必须通过 session/runtime/gateway contract 访问。Visible conversation history 只能在 terminal durable-write boundary 成功后更新。

Timeline 是执行事实序列；RequestRun 是执行尝试状态；Session message 是用户可见历史。三者不得互相替代。

execution-time assistant tool-use、capability result 和其它 session message 由 Agent core 通过 runtime-owned message port 表达；runtime 使用 trusted RequestRun/RequestContext 补齐 owner/agent/session/request/run 坐标后写 gateway Record。Agent core 不直接构造 gateway Record。

同一模型 round 内的 ordinary tool call batch 属于同一个 RequestRun 执行事实。runtime 与 RequestRun durable model 不拥有“按完成顺序回填结果”的第二套真相；同批 tool call 可以重叠执行，但下一轮模型可见的 tool result 顺序必须仍按原始 tool call 顺序表达。pending-input 型 tool call 仍保持批内互斥语义，不得在同一 round 产生多个待恢复事实。

## Agent Turn 与 Tool Call Admission

accepted `AgentAssembly.runtimeSettings.maxTurns` 是一个 `RequestRun` 唯一的 logical Agent loop-count 上限，缺省为 `50`。`RequestContext.agentTurnIndex` 与 checkpoint 中的同名字段保存唯一运行坐标：normal turn 为 `0..maxTurns-1`，达到 `index=maxTurns` 后只能执行一次 finalizing model turn。finalizing 保留原 Tool descriptors，但 effective `toolChoice=NONE`；模型、terminal hook 或任何其他来源返回的 Tool call 都不得执行。finalizing 产生可用文本时正常完成；取消、模型失败或无可用文本时保持真实失败/取消终态。runtime 不增加 finalization phase、command 或第二套状态机，terminal commit ownership不变。

`maxToolCallsPerTurn` 缺省为 `30`、有效域为 `1..100`，只限制模型在单个 normal turn 返回的 Tool call 接纳前缀。系统按原始顺序保存并治理最多该数量的 calls；超限尾部不保存、不执行、不生成 synthetic result。已接纳前缀完成并保持 tool-use/result 配对后，runtime-owned feedback 向下一模型轮报告 requested/admitted/omitted counts。空名称、重复失败和连续超限都不建立局部 recovery counter 或 terminal reason；收敛仍只由模型结束、显式生命周期控制、取消或 `maxTurns` 决定。

## 验证入口

- recovery contract tests
- run version and claim/fencing tests
- session lane scheduling tests
- request cancel/retry tests
- terminal commit idempotency tests
- recovery failed terminal tests
- timeline replay tests
- session history consistency tests

## Capability 失败处置协作

RequestRun 只承载 accepted lifecycle、canonical timeline 和 terminal truth；Capability attempts 是一次逻辑调用的内部细节，中间失败不写 run timeline。普通 Agent 的最终 Tool result、每轮前缀接纳、一次 finalizing 和 `agentTurnIndex` 恢复规则由 `openspec/designs/architecture/capability-invocation-and-failure-disposition.md` 定义，runtime 必须持久化这些 owner 已决定的事实而不重新解释业务失败。
