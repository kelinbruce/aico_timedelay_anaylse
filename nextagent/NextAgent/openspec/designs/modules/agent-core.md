# agent-core

## 职责

本模块拥有 capability directive 的解析与 normalization：有效 directive 产生唯一结构化路由目标和有效用户问题；无效或冲突 directive 保持现有 fail-closed routing owner。

本模块不扫描 rendered context 中的 Skill 路径，也不参与 Skill projection resource authority 的恢复。

承载默认 Agent orchestration、model-driven loop、context render 调用、model invocation、enabled capability tool loop、output guard 和 Agent 内部 request routing policy boundary。

## 非职责

不实现 provider SDK 调用、gateway adapter、Web channel 或 app composition。不直接构造 gateway `*Record`、写 session message、写 checkpoint、写 capability audit、提交 terminal lifecycle 或决定 recovery classification；执行期 side effects 必须通过 runtime-owned `AgentRunStatePort`。

## 依赖

允许依赖 `@nextagent/agent-common` 和 `@nextagent/agent-contracts/runtime`、`agent-contracts/context`、`agent-contracts/model`、`agent-contracts/capability`、`agent-contracts/agent-assembly`、`agent-contracts/observability` public subpaths。不得依赖 gateway contract、gateway adapter、provider SDK、Web channel、app composition 或其它 implementation package。

## 核心设计落点

- ordinary Agent 把所有非取消的最终 Capability 失败作为下一模型轮输入；重复错误、空 Tool 名称和 output-invalid 都不建立 fingerprint、局部次数阈值或自动终止。只有显式 `REQUIRE_AUTHORIZATION`、Hook control、pending input、取消或模型终止改变控制流。
- `maxTurns` 是每个 accepted run 的唯一 logical loop-count bound。达到上限后执行且仅执行一次 finalizing model turn，保留 Tool descriptors并强制 effective `toolChoice=NONE`；任何返回的 Tool call 都零执行。
- `maxToolCallsPerTurn` 只接纳每个 normal turn 的有序 Tool call 前缀；超限尾部不保存、不执行、不合成 result，前缀闭合后向下一模型轮反馈 requested/admitted/omitted counts。Agent Core 独占 admission 与 finalizing 决策，但不拥有 checkpoint 或 terminal commit。

- 落实 `architecture/core-contracts.md` 的 `Agent.execute`、`AgentRunStatePort`、model invocation、capability catalog/invocation 和 runtime-owned run state side effects。
- 落实 `architecture/conversation-process-history.md` 的 model-invocation thinking completion：default Agent 在单次 invocation 内累计 non-empty reasoning，调用中发布完整累计 `LLM_THINKING_DELTA`；统一 model terminal path 在 `MODEL_INVOCATION_COMPLETED | MODEL_INVOCATION_FAILED` 前至多一次把最后累计 delta 标记 `completed=true` 并交给 runtime。无 reasoning 不生成完成 event，workflow node、request terminal 和 tool-loop boundary 不得补写或推断 thinking completion。
- core 作为模型调用 owner，使用单调时钟为每次成功完成的 concrete provider invocation 计算 `modelE2ELatencyMs`（从 invocation 开始到成功 terminal result），并在系统观察到首个非空 content delta、非空 reasoning delta、tool call delta 或成功 terminal result 中首个非空 content/reasoning/tool call 时一次性冻结 `firstContentLatencyMs`。两个字段以非负整数毫秒写入 `AFTER_MODEL_RESULT` boundary，只供 observe-only hook 读取，不参与 mutation；provider SafeError 或 thrown exception 不为 timing 补造 `AFTER_MODEL_RESULT` boundary，成功结果无任何可识别反馈时省略 `firstContentLatencyMs`。
- 落实同一架构的 Message-first process producer：Tool 轮次说明/调用先写 `ASSISTANT_TOOL_USE`，Tool 结果先写 `CAPABILITY_RESULT`，随后才用返回的 `MessageId` 发布 completed `LLM_CONTENT_DELTA`、`CAPABILITY_STARTED` 或 result-bearing `CAPABILITY_COMPLETED`。ordinary、失败/降级/超时、AskUserQuestion resume、Workflow 和 structured Tool 分支复用同一 helper；消息失败不得产生孤儿引用事件，持久化事件不得复制正文、Tool 参数或结果。ordinary `CAPABILITY_COMPLETED` 只发布 `messageId`、Tool identity、状态和其他非正文坐标，不接受也不再优先使用 Tool result 正文副本。
- model tool loop 必须把 `ModelToolCall.toolName` 解析到当前 Agent 可见 capability descriptor 后，再通过 `CapabilityInvocationPort` 执行；core 内部 capability execution 继续使用解析后的 `capabilityId`。
- model tool loop 在发布受治理 Capability lifecycle 时必须从已解析 descriptor 形成不可变的公开执行身份；`Agent`、`Skill`、`Workflow` 通用入口只附带归一化后的直接目标 id，不公开参数、描述或业务名称。started/completed 对同一次调用复用同一身份，失败、超时、取消和结果校验失败不得重新解释目标。
- 同一模型 round 内相互独立的 ordinary tool call 可以并行调度，但必须先完成批次构建，再按模型原始 tool call 顺序把结果回填给下一轮模型；core 不得按完成先后重排结果。
- tool loop 在遇到会创建 runtime-owned pending input 的 tool call 时，必须保留现有互斥语义：该 tool call 之后的同轮调用不得抢先执行，也不得从一个 round 产生多个 pending input 事实。
- 落实 `architecture/runtime-boundaries.md` 的 runtime owns terminal lifecycle；Agent core 只发布执行事实，不直接写 terminal history。
- 落实最小内核的 read capability tool loop 和 output guard，不把文件读取或 provider SDK hardcode 到 core。
- tool loop 不跟踪重复失败 fingerprint，也不按同一 capability、参数或错误的出现次数终止 run；每个非取消最终失败都必须以完整安全 `CAPABILITY_RESULT` 反馈模型，并重新经过正常治理边界。
- tool loop 还拥有普通 Tool 的 in-flight result delta forwarding：当 capability invocation runtime context 提供 delta emitter 时，core 负责把累计安全结果以既有 `CAPABILITY_RESULT_DELTA` 投影到运行流中，同时保持单次 terminal capability result message 和单次 `CAPABILITY_COMPLETED` 真相不变。
- tool loop 每个 normal turn 只使用 accepted assembly 的 `maxToolCallsPerTurn` 接纳模型返回的有序 Tool-call 前缀。前缀经过统一 preflight、governance、执行和 message pairing；超限尾部不保存、不执行、不生成 synthetic result。前缀闭合后 core 用 runtime-owned request-local feedback 报告 requested/admitted/omitted counts 并继续普通 loop。model-only 与 finalizing 保留 Tool descriptors、强制 effective `toolChoice=NONE`，任何违规返回 Tool call 都零执行；不存在 read-only/side-effecting 平行数量预算、局部 recovery counter 或 Tool-call terminal reason。
- `BEFORE_PLANNING` 和 `BEFORE_AGENT_TERMINAL` 的真实 stage owner 在 core：前者位于每个 planning turn 的 context assembly / model request construction 之前，位置在请求/技能路由和 routing constraints 已解析、当前 planning-turn 输入已确定之后；boundary 包含 round index、step id、effective step limits 和进入该 planning turn 前已累积的 request-local capability generated messages 和 context patch effects；boundary 不得包含尚未执行的本轮模型输出、tool calls、capability result 或 context patch。后者位于 agent loop 判断正常退出、无来自模型的待执行 tool calls、最终 content 已形成之后、最终用户可见 final-content event 发送之前。core 只消费 runtime-owned hook result 和 effective boundary，不拥有 hook registry 或 executor。
- core 还是 `CAPABILITY_SELECTED` 轨迹输入的 owner：在 capability descriptor 已解析、routing/subagent guard 已通过且真正进入执行器之前，core 只允许发出 capability id、kind、toolCallId、selection reason code 和稳定 refs 等安全摘要；不得把 raw tool args、raw tool result、provider payload 或 host path 作为 trajectory 输入。
- `BEFORE_CAPABILITY_INVOKE` 和 `AFTER_CAPABILITY_RESULT` 也由 core tool loop 拥有：前者在 tool call 已解析为 capability id、descriptor / routing constraints / subagent guard 已通过、`CapabilityInvocationRequest` 已构造之后、`CAPABILITY_BEFORE_CALL` checkpoint / `CAPABILITY_STARTED` event / `capabilityInvocation.invoke(...)` 之前触发；后者在 `capabilityInvocation.invoke(...)` 返回 raw result 且 basic `CapabilityInvocationResult` envelope validation 通过之后、effective result validation / status-specific handling / `buildModelVisibleCapabilityPayload(...)` / capability result message append / capability completion event 之前触发。invocation throw 或 invalid result envelope 走 safe error path，不暴露 transformable result boundary。`buildModelVisibleCapabilityPayload` 是 Capability result 进入后续模型上下文和 durable `CAPABILITY_RESULT` 前的通用投影 owner；它以 exact top-level key 删除 `metadata.toolDiagnostics` 和 `metadata.sourceTrace`，不递归扫描 `structuredPayload`、不解析 Tool 业务 payload、不按 capability id 或 Tool 名称建立例外，并保留其他已接受的安全 metadata。`runtimeToolOutputLogFields` 不调用该投影 helper，继续记录原始有效 Capability result，因此本地 canonical `toolOutput` 保留完整业务 payload 和内部来源诊断。
- normal turn 的 `BEFORE_AGENT_TERMINAL` 返回非空 `toolCalls` 时，agent-core MUST NOT 发送本次 final-content event，MUST 让这些 calls 经过当前 Agent binding、descriptor、routing、subagent guard、input schema 和 `maxToolCallsPerTurn` admission 后继续 tool loop，并继续触发 `BEFORE_CAPABILITY_INVOKE` / `AFTER_CAPABILITY_RESULT`。finalizing turn 中 Hook 新增的 Tool call 必须零执行。非空 `toolCalls` 与 `finalContent` replacement 不得出现在同一 mutation result；`DENY` / `BLOCK` / `PEND` 保持显式控制语义。
- `Agent.execute` 必须消费 runtime 传入的 cancellation context/AbortSignal；cancel 后的 late model/capability output 只能由 runtime guard 处理，core 不提交终态。
- recovery 时 core 只按 runtime 重新进入的执行上下文继续/失败；不扫描 gateway facts，不自行重放 capability，不改写 run status。
- core 拥有 routing constraint governance、targeted Skill routing、policy regex routing、开放 `agentRoutingPolicy` typed adapter 和 model fallback orchestration；它消费 accepted `routingConstraints`、runtime-owned `acceptedInputText`、frozen `AgentAssembly`、governed capability view、app/runtime injected policy resolver 以及 Context Engine 返回的 model selection result，但不读取 model profile 或把这些事实提升为新的 public DTO。
- core 拥有非 agentic Skill 驱动 API 调用的编排拦截。`DefaultAgent.executeRun` 的 tool loop 在 `executeToolCallsInOrder` 返回后、下一次 model invocation 之前检测 `Skill` tool 结果 `metadata.nonAgenticApiCall === true` 信号。检测到后，编排层从 `structuredPayload` 提取 api name、hiro value、skill identity、`apiHeaderParams`、`apiRequestParams`，从 `RequestContext.acceptedInputText` 获取用户问题，从当前请求头提取 header params，从 trusted context 获取 request params，通过 `capabilityInvocation.invoke()` 程序化调用隐藏 `ApiCall` tool（与 `TargetedSkillRouter` 同一套 governance/audit/validation 机制，不经模型）。`ApiCall` tool 返回后把 `structuredPayload` 写入 terminal assistant message，跳过后续 model invocation。编排层不做提参。同一轮 tool calls 中同时存在 flag=false 的 `Skill` tool result 和其他 tool result 时拒绝并返回 `NON_AGENTIC_BATCH_CONFLICT`。调用 `ApiCall` tool 前后保存 checkpoint；恢复时发现已进入非 agentic 路径但未拿到结果则返回失败不重试。跨模块装配和 `ApiCall` tool 事实见 `architecture/skill-driven-api-call.md`。
- core 拥有自然语言 capability directive 解析：只从 runtime-owned accepted request text 识别 `$skill:<name>` 和 `$workflow:<name>`。parser 只能接受 safe capability identifier，拒绝 whitespace、路径、URL、credential、owner/agent scope、provider override、shell metacharacter 或 prompt 拼接。`$skill:` 只产生 governed target Skill routing input，不设置 `targetRecipe`；`$workflow:` 只产生 `routingConstraints.targetRecipe`，不重解释为 Skill。重复同一目标可归一化，不同 Skill、不同 Workflow 或 Skill+Workflow 混用必须 fail closed 或进入受控澄清，不得按出现顺序静默选择。
- directive-derived targets 与 request-carried non-target constraints 使用同一 governance：当前 Agent Scope capability catalog、Owner Scope visibility/authorization、kind/type、availability、forbidden constraints、budget、deadline 和 cancellation 都必须通过后才可执行；miss、forbidden、type mismatch、unavailable 或 unsafe syntax 只能输出 safe reason code，不暴露 private catalog/provider facts。
- core 拥有 runtime Skill acquisition 的 replan 协议。acquire_skill 等受控 acquisition capability 成功返回 `ACQUIRED_REQUIRES_REPLAN` 后，core 必须保持当前 model invocation toolset 不变，先按普通 capability result path 追加安全结果，再进入下一 planning/model round 并重建 capability snapshot。失败按普通 capability failure/degraded result 进入既有规划路径。
- core 拥有 CLIP structured delta emission decision in the tool loop。只有 resolved descriptor provider 为 `CUSTOM` 且 `providerType="clip_server"`、结果 shape 和内容安全校验通过时，core 才可在保留 `CAPABILITY_RESULT_DELTA` 和 capability result message 的同时额外发布 `TOOL_STRUCTURED_DELTA`。普通 JSON、非 CLIP provider、未知 event/message type 或敏感内容都回落到既有 capability result delta path。
- core 在 terminal 前必须消费当前 todo projection。若 `TodoWrite` 留下未完成 todo，core/runtime 只能给模型一次受控 reconcile 机会或要求显式说明原因，不得静默提交 terminal complete。
- core 独占 provider-neutral 输出恢复，主 owner 为私有 `model-output-recovery.ts` 与 `model-route-execution.ts`，`DefaultAgent` 只编排 model turn、cross-model fallback、terminal 和 Tool loop 分流。恢复入口只消费已校验的 `ModelFinalResult.incompleteOutputReason`，不得重新按 `finishReason`、provider 名称或模型名称推断完整性。`output-limit` 与 `truncated-tool-call` 均先只覆盖 `maxOutputTokens` 重试一次同请求（提升值 = 原有效值 × 8，上限 `32000 tokens`，且不超过 `contextWindowTokens - 输入估算` 的剩余窗口；原值未显式时候选为 `32000`，只有严格大于原有效值才发起）。预算提升后的 `output-limit` 若 content 为空、无 Tool call 且 reasoning 非空，则在普通续写前通过既有 `reasoningCorrectionAttempted` guard 注入且仅注入一次 request-local 收敛指令，要求模型直接给出可见回答或一次完整 Tool call；首次 `length` 不得跳过预算提升，correction 后仍不完整才进入最多 3 次 request-local 续写。续写把上一段 assistant 文本和隐藏"直接从截断处继续"指令追加到本次恢复调用 messages，续写段按序拼接为单一最终回答，中间 correction、assistant 段和恢复指令不调用 `AgentRunStatePort.appendMessage()`、不持久化。首次为 `truncated-tool-call` 时，预算提升后仍有任一不完整原因即发布 `MODEL_OUTPUT_TOKEN_RECOVERY_UNSAFE_TOOL_CALL` 并安全失败，不进入文本续写；原调用与恢复阶段的残缺 Tool call 均零执行。第 3 次续写仍为 `output-limit` 或续写阶段产生不完整原因/Tool call 时发布 `DEGRADATION_NOTICE`（`MODEL_OUTPUT_TOKEN_RECOVERY_EXHAUSTED` / `MODEL_OUTPUT_TOKEN_RECOVERY_UNSAFE_TOOL_CALL`）并以 safe `REQUEST_FAILED` 结束，不提交截断回答。恢复调用复用同一模型路由、messages、Tool 集合、provider-neutral options、当前 `AbortSignal`、timeout、Agent/Owner Scope，不新增 provider-specific 分支、容差或配置字段；恢复计数以 model round 为边界，不占用 `maxToolIterations`。同一 model round 的 `hasVisibleOutput` 在原调用、预算提升、correction 和续写间累计，已流出任一候选内容时继续禁止 cross-model fallback 切换。
- core 把 direct model 可见文本硬上限对齐 runtime 的 `150000` 个 UTF-16 code unit（`maxModelVisibleChars`）。累计 provider-neutral 文本首次超过该上限时立即停止当前 provider stream，不进入 Token 恢复、fallback 或 Tool call 分支，发布恰好一次 `DEGRADATION_NOTICE(code=MODEL_TEXT_LIMIT_EXCEEDED)`；从累计文本保留顺序前缀（不拆分 UTF-16 surrogate pair，必要时闭合末尾未闭合 Markdown code fence 或 table row），追加固定标记 `[Model output truncated at the 150000-character safety limit.]`，总长不超过 `150000` 个 UTF-16 code unit，作为唯一 terminal assistant message 提交，请求以 `REQUEST_COMPLETED` 结束。超限后缀、未完整 Tool call 和 raw provider payload 不进入 stream/history/SafeError/audit/log；降级事件只携带稳定 code，不含模型文本。恰好等于上限时原样提交，不发布降级事件。
- `mode=policy` 的当前稳定实现只允许 trusted `policy:intent-recognition` 配置声明 ordered regex rules；规则按声明顺序首个命中生效，可把请求导向既有 governed Skill loading path 或既有 workflow execution path。core 不执行用户定义 policy code，不消费 raw prompt、model output 或 capability args 作为 routing authority。
- 当 accepted AgentAssembly 激活 `agentRoutingPolicy` 时，core 通过 `AgentPolicyResolverPort.resolve({ agentId, agentVersion, agentAssemblyRef, policyPointId: "agentRoutingPolicy" })` 查询插件 policy；返回 undefined 时执行既有默认 routing policy，返回 executable 时按既有 `AgentRoutingPolicy.decide(RequestRun, RequestContext, AbortSignal)` contract 执行。core 不先跑默认 policy 再交给插件，也不在 wrapper 中重写、截断或摘要化 `RequestRun` / `RequestContext`。
- `agentRoutingPolicy` 插件结果必须是既有 `AgentRoutingDecision` shape：`kind` 属于 `DETERMINISTIC_FLOW`、`MODEL_DRIVEN_LOOP`、`CLARIFY`、`REJECT` 或 `HUMAN_HANDOFF`，并携带 safe reason / optional evidence / optional skill name 等既有字段。插件不得返回 workflow/private implementation handle、raw prompt、model output、capability args 或 plugin-specific routing fields；core adapter 负责把合法 routing decision 接到既有 Skill/Workflow/model loop path。
- 插件 routing policy throw、timeout、abort 或 invalid result 必须 fail closed 为 safe routing rejection。Reserved/unknown policy point、missing executable、duplicate activation 和 invalid config 不应到达 core runtime path，必须由 app/assembly/runtime materialization 阶段拒绝。
- canonical `AskUserQuestion` producer branch 只接受精确名称且解析为 `builtin-tools + BUNDLED + AVAILABLE` 的 governed descriptor。core 必须在持久化 assistant tool-use batch、修改 tool-call state、执行同批其他 Tool 或请求 runtime 创建 pending input之前，对 normalized `questions` 做无副作用 count preflight：1–3 题按 resolved descriptor 原样校验；4–20 题只使用 request-local validation view 把顶层 `questions.maxItems` 从 3 放宽为 20，其余 schema、可见文本、option uniqueness 和 forbidden-purpose 规则必须完全复用；该 view 不得写回 descriptor、catalog、context 或 provider。超过 20 题或其他可纠正输入失败时，core 返回与原 tool call 配对的完整 canonical validation result，由普通 Agent 模型决定如何修正；被拒批次不得落 message、创建 pending input、发布 `USER_INPUT_REQUIRED` 或产生同批副作用。AskUserQuestion 不建立独立连续计数器或相同失败终止阈值，仍只受 `maxToolCallsPerTurn` admission 与 `maxTurns` 收敛约束。
- user-facing Agent 可以在 blocking ordinary user input 场景下直接使用 `AskUserQuestion`；invoked read-only Agent 或受 no-nesting safety 限制的 child Agent 不得直接拥有该交互能力。core 只消费 composed capability visibility与 binding fact，不为不同 Agent 发明第二套语义路由。

## 替换边界

否。Agent/core orchestration 是内部执行边界；具体 Agent/capability 扩展由后续 contract 定义。

## 验证关注点

- 业务语义 routing 位于 Agent 内部 policy，不得前置到 runtime/channel。
- `routingConstraints` 只能在 Agent 内部做 governance；core 不得把 schema-valid constraint 视为直接授权。
- target Skill 必须通过 request-scope capability governance 解析为 kind=`SKILL` 的受控执行；不得全局搜索替代 Skill。
- policy regex routing 只能读取 runtime-owned accepted input text 和 trusted Agent config；未命中时必须回退 model-driven loop，非法 regex/target shape 必须 fail closed。
- 插件 `agentRoutingPolicy` 必须与存量 routing policy 使用同一输入输出形状；输入收紧若未来需要，只能发生在 core routing 业务流程中，不能由 policy registry 或 wrapper 私自投影。
- fallback-applied、fallback-denied 和 fallback-exhausted 由 core 显式编排；不得让 `agent-model` 隐式切换 profile。
- 不得导入 provider SDK、gateway contract、gateway adapter、PaaS SDK、Web channel 或 app composition。
- dynamic execution 必须经过 sandbox gateway boundary。
- tool-use message、capability result message、checkpoint 和后续 execution-time session message 必须通过 `AgentRunStatePort`。
- recoverable process content 必须覆盖 Message-first ordering、同类终态分支和 message-write failure negative tests；core 不得建立第二个 event-body authority。
- AskUserQuestion count preflight 必须通过 3/4/20/21、同批 side-effect 隔离、纠正预算耗尽和 non-count validation negative tests；不得静默截断、拆成多个 pending input 或把内部 20 题兜底暴露给模型。
- cancel 后 late output、runtime terminal ownership 和 recovery defensive guard 必须由 runtime/core characterization tests 覆盖。
- normal completion、safe error、throw 与 abort 必须覆盖 completed thinking append-before-model-terminal 顺序；workflow lifecycle 不得合成 thinking，completed event 不得创建重复 process entry。

## Capability 失败处置协作

本包消费统一最终结果，并独占普通 Agent 的模型恢复、`maxToolCallsPerTurn` 有序前缀接纳、`maxTurns` 收敛、单次 finalizing turn 和 post-hook Tool 执行硬门禁。非取消失败、空 Tool 名称和连续超限都不得创建局部 failure fingerprint 或终止阈值；AskUserQuestion 只保留创建 pending input 前的窄化 preflight。完整状态转换、feedback 和配对不变量见 `openspec/designs/architecture/capability-invocation-and-failure-disposition.md`。

## Public Exports

`@nextagent/agent-core`
