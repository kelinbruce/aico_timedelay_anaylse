## 背景和现状（Context）

`stable ts-backend-architecture` 已经规定 `agent-runtime` 拥有 request submit、cancel、retry、edit、scheduling、same-session lane policy、latest-request handling、terminal commit 和 canonical timeline publication。`stable ts-core-contracts` 已经冻结 `RequestControlCommand`、`RuntimeCommandPort.retryLatest`、`RequestAccepted`、`RequestRun.retryOfRunId`、`RunStatus`、`TerminalCommitState`、`SessionMessageStoreGateway.hideMessage`、SafeError、Agent Scope 和 Owner Scope 语义。

`add-ts-session-lane-scheduling` 已经确定 submit 和后续 accepted work 都先成为 durable queued run，再由 Runtime scheduler 串行 dispatch 同一 agent+owner-scoped session lane。`add-ts-request-cancel` 已经固定 request control 的风格：Channel 只构造可信 command，Runtime 做 agent+owner/latest/status/idempotency 判断，用户可见事实来自 durable Runtime/Session facts。

本 change 处理 retry：用户对当前会话最近一次已结束请求发起 retry 时，系统要创建同一 root request 的新 execution attempt，而不是复制用户输入作为新请求。retry 必须保留旧 attempt 的可追溯性，同时让默认历史视图以后展示新 attempt 结果。旧结果可见性通过 `hideMessage` 改变，不能靠删除、覆盖或重新保存 message 内容实现。

目标语义已经由 core contracts 和前置 runtime changes 固化：Runtime 校验 action、latest request、terminal status 和 terminal commit state；retry 复用原 root USER message；新 `RequestRun` 生成新 `runId`、递增 `attempt`、设置 `retryOfRunId` 并保留 source run 的 `agentId`、`agentVersion`、`agentAssemblyRef`；accepted retry 重放只能在 Agent、lane、run persistence 和 scheduler 成功后，从新 retry `RequestRun` 的 acceptance idempotency anchor 推导，并在 schedule 成功后应用 retry visibility。core contracts 已经明确 retry 成功返回 `RequestAccepted`，因为 retry 创建新的 run/attempt。

## 目标和非目标（Goals / Non-Goals）

**目标：**

- 定义 retry 只能通过 `RuntimeCommandPort.retryLatest(RequestControlCommand)` 进入 Runtime。
- 定义 agent+owner-scoped latest target selection：`tenantId + subjectId + agentId + sessionId + expectedLatestRequestId`。
- 定义 retryable 状态：latest run 必须 terminal 且 `terminalCommitState=COMMITTED`。
- 定义 retry identity：同一 root request/new `runId`/递增 `attempt`/`retryOfRunId` 指向上一 attempt。
- 定义 retry source attachment 重新校验：复用原 root USER message 的 attachment refs，但接受 retry 前重新验证 agent+owner scope、`validationStatus=ACCEPTED`、`availabilityStatus=AVAILABLE` 和现有 `RequestAttachmentRecord` metadata。
- 定义 retry 成功返回 `RequestAccepted(sessionId, requestId, runId, attempt)`，且该返回只在 retry run durable queued/scheduler accepted 后出现。
- 定义 retry run 使用同一 session lane 和 Runtime scheduler，不绕过 terminal-pending protection、capacity 或 recovery boundary。
- 定义旧结果替换：scheduler accepted 后使用 `hideMessage` 隐藏上一 attempt 的 assistant/capability messages，保留 root USER message 和旧结果可追溯性。
- 定义 retry 新 attempt 的模型上下文不能把旧 attempt 输出当作普通历史输入。
- 定义 retry idempotency、queue failure terminalization、visibility replacement recovery handoff 和 retry-specific SafeError；accepted retry 重放只能从新 retry `RequestRun` 的 acceptance idempotency anchor 推导，不新增独立 command outcome fact。
- 定义 Channel、Runtime、Session、Context、Gateway、Agent/Core/Model/Capability 的职责边界。

**非目标：**

- 不新增 `RunStatus`、`TimelineEventType`、`StreamEventType`、`RequestControlCommand` 字段或 retry 专属 gateway port。
- 不实现 edit-resubmit 用户语义。
- 不支持任意历史 request retry 或按 `runId` 选择历史 attempt retry。
- 不实现完整 local runtime recovery、多实例 lock/lease/shared state 或 non-sticky routing。
- 不定义 stream replay cursor/gap outcome 或 transport-specific reconnect 行为。
- 不定义 attempt history UI、includeHidden UI 或复杂前端按钮展示规则。
- 不定义本地数据库 schema、索引或文件布局。

## 设计决策（Decisions）

### D1: Retry 使用既有 Runtime command contract

选定方案：Web/API retry 只构造 `RequestControlCommand` 并调用 `RuntimeCommandPort.retryLatest`。Runtime 使用 `identityContext`、`sessionId`、`expectedLatestRequestId`、`action=RETRY_LATEST` 和非空 canonical `idempotencyKey`；本 change 不新增 `RetryRequestCommand`、`targetRunId`、`OwnerScope` DTO 或泛化 `targetId/input/metadata`。

理由：核心契约已经冻结 request control command 字段和 agent+owner scope 语义，Agent Scope 由可信 app/session/run 决定而不是客户端字段。复用同一 command 可以让 cancel/retry/edit 的 latest-request optimistic check 一致，并避免 Channel 或客户端绕过 Runtime latest policy。

拒绝方案：新增按 `runId` 任意 retry 的 API。拒绝原因是它会允许客户端挑选历史 run，绕过 current latest 语义、agent+owner-scoped lane policy 和替换可见性规则。

边界说明：本 change 只要求 Runtime command boundary 接收到 canonical `idempotencyKey`，不定义 public Web DTO 是否要求客户端传 key，也不定义 Channel 的生成策略。Runtime 不从 client metadata、模型输出或 capability input 中推断或补齐 key；缺失或空 key 在 Runtime 内是 validation failure，不能产生 run、queue、visibility 或 timeline side effect。

### D2: Target selection 只允许 latest terminal committed request

选定方案：Runtime 通过 agent+owner-scoped lane facts 判断 `expectedLatestRequestId` 是否等于当前 latest request。只有 latest request 的 latest run 处于 terminal status 且 terminal commit 已 `COMMITTED` 时，retry 才合法。Terminal statuses 为 `COMPLETED`、`FAILED`、`CANCELED`、`SUPERSEDED`。

理由：用户语义是“重试当前最近已结束请求”，不是重跑任意历史消息。terminal commit 是历史/stream 可见性的稳定边界；未 committed 的 terminal 可能还会失败、重试或被 recovery 修正，不能作为 retry source。

拒绝方案：只允许 `COMPLETED` retry。拒绝原因是 retry 的主要价值之一是处理瞬时 `FAILED`、被用户取消后想重新跑、或被 replacement 标记后的最新 terminal 状态；core contracts 的 terminal outcome 集合也包含 `FAILED`、`CANCELED`、`SUPERSEDED`。

### D3: Retry 是 same request 的 new attempt，不是 new request

选定方案：retry 保持原 root USER message 和 `requestId` 不变，创建新的 `RequestRun.runId`，`attempt` 递增，`retryOfRunId` 指向上一 attempt。连续 retry 时 attempt 3 指向 attempt 2，不直接跳回 attempt 1。

持久化边界：`retryOfRunId` 是 retry attempt lineage 的 durable fact，必须进入 gateway `RequestRunRecord` 和 local persistence mapping；只在 Runtime 内存对象或测试 fixture 中设置不足以满足本 change。该字段只表达 retry attempt 链，不承担 latest、cancel、scheduler 或 visibility 决策。

理由：retry 的语义是“同一输入再执行一次”，这样 history、audit、capability invocation、terminal events 和用户反馈能按 attempt 链追踪。edit-resubmit 才是新 root USER message/new request 的语义。

拒绝方案：retry 复制用户输入并创建新 request。拒绝原因是它会混淆 retry 与 edit/resubmit，丢失同一 request 的 attempt lineage，也让旧结果替换可见性难以定位。

### D4: Retry 复用原 run 的 resolved AgentAssembly

选定方案：retry run 和 retry execution context 使用 source run 已冻结的 `agentId`、`agentVersion` 和 `agentAssemblyRef`。retry 不重新解析当前 active AgentAssembly。

理由：retry 要比较同一请求在新 attempt 下的执行结果，不能因为 Agent package 已升级、routing policy 改变或 capability binding 更新而静默换执行装配。需要用新版 Agent 重新发起时，应走显式 new submit 或后续独立能力，而不是 retry。

拒绝方案：retry 时重新读取当前 active AgentAssembly。拒绝原因是这会让 retry 同时承担“重试”和“升级后重跑”两种语义，审计和问题复现都变差。

### D4A: Retry 在 accepted 前重新校验 source attachments

选定方案：retry 复用原 root USER message 的 attachment refs，但 Runtime 在创建并接受 retry run 前必须通过 attachment boundary 重新校验这些 refs 仍属于同一可信 agent+owner scope、`validationStatus=ACCEPTED`、`availabilityStatus=AVAILABLE`，并且仍有现有 `RequestAttachmentRecord` metadata 可供 context assembly 使用。校验失败时返回 safe error，不创建 retry run、不进入 scheduler、不隐藏旧结果。

理由：backend architecture 已经把 request/retry/edit-resubmit 的 attachment refs validation 放在 Runtime 接受请求的前置流程里。Retry 虽然复用原输入，但附件是外部资源引用，可能已被撤销、过期、隔离或跨 owner 不再可见；如果不重新校验，新的 retry attempt 可能在模型上下文装配阶段才失败，或者更糟地读取到不该读取的资源。

拒绝方案：完全信任原 request 当时通过的 attachment 校验。拒绝原因是它把“历史 request 可追溯”误当成“当前 retry 可重新读取资源”，会绕过 agent/owner scope 和资源可用性边界。

边界说明：retry 只消费 attachment runtime/gateway 的 agent+owner-scoped validation、availability 和现有 `RequestAttachmentRecord` metadata，不新增 `AttachmentSafeDescriptor`、attachment ownership、cleanup、storage schema 或跨 owner fallback。若 attachment ref 在 retry 时不可读、过期或跨 scope，retry 必须 fail closed。

### D5: Retry accepted 必须晚于 durable queued/scheduler accepted

选定方案：`RuntimeCommandPort.retryLatest` 只有在新 retry run 已 durable 创建、进入 `ACCEPTED`/`QUEUED` 并被 Runtime scheduler 接受后，才返回 `RequestAccepted`。`RequestAccepted` 不承诺 Agent execution 已开始或完成。

理由：core contracts 已经定义 `RequestAccepted` 表示 Runtime 已接受并创建对应执行实例。只做 policy decision 就返回 accepted 会污染幂等：后续同 key 重试会以为 run 已存在，但实际没有排队。

拒绝方案：`retryLatest` 先返回 accepted，再异步尝试保存/排队 run。拒绝原因是 queue/scheduler 失败时客户端已收到成功，old result visibility 和 idempotency 都会进入不一致状态。

### D6: Retry 进入同一 scheduler 和 lane

选定方案：retry run 进入与普通 submit 相同的 agent+owner-scoped session lane 和 Runtime scheduler。retry 不能绕过 queue、global capacity、same-lane serial dispatch、terminal-pending protection 或 scheduler rebuild/correction。

理由：retry 仍然会写同一 session 的 terminal/history facts。若绕过 scheduler，它可能和当前 same-lane executing/terminal-pending work 并发写 terminal 事实。

拒绝方案：retry accepted 后立即调用 Agent execution。拒绝原因是它绕过 `add-ts-session-lane-scheduling`，与“submit -> queued -> scheduler dispatch”流程不一致。

### D7: Queue/scheduler failure terminalizes新 retry run，且不隐藏旧结果

选定方案：如果 retry run 已 durable 创建但无法进入 queue 或 scheduler accepted，Runtime 必须通过 terminal boundary 将这个新 retry run 收敛为 `RunStatus.FAILED`，并使用 retry queue unavailable 的 safe terminal reason。Runtime 不隐藏上一 attempt 的 messages，不形成 accepted retry idempotency anchor。

理由：durable run 一旦创建，就不能悬挂在不清楚的 active 状态里；但 retry 没有真正成为可执行替换 attempt，不能改变默认历史视图。queue failure characterization tests 必须覆盖 queued persistence rejection 后 accepted run 被 terminalize 的语义。

拒绝方案：queue 失败时删除 retry run。拒绝原因是删除 durable fact 会破坏 audit/recovery。
拒绝方案：queue 失败时隐藏旧结果。拒绝原因是用户没有得到可执行的新 attempt，默认历史不应被替换。

### D8: Visibility replacement 晚于 scheduler accepted

选定方案：Runtime 在 retry run 已经成功 queued/scheduler accepted 后，使用 `SessionMessageStoreGateway.hideMessage(HideMessageRequest)` 隐藏上一 attempt 的非 USER messages。隐藏范围固定为：同 root request id、同 previous runId、role 不是 USER 的 messages。root USER message 保持可见。

持久化边界：`hideMessage` 必须是 gateway/session message 的幂等 visibility update，而不是 Runtime 重新保存 message content、删除 message 或维护内存隐藏表。retry replacement 至少持久化 `visible=false`、`reason=RETRY_REPLACED`、`hiddenByContextId`、stable hide idempotency key 和 first-writer metadata；重复调用不得覆盖首次隐藏上下文。

理由：旧结果只有在新 retry attempt 已经被 Runtime 接受为 durable queued work 后才应退出默认历史；否则 queue failure 会让用户既没有新 attempt，又看不到旧结果。目标语义要求 retry visibility 延迟到 Runtime 确认 schedule 成功后。

拒绝方案：retry policy decision 一通过就隐藏旧结果。拒绝原因是后续 Agent/lane/persistence/scheduler 失败会造成默认历史被提前污染。
拒绝方案：隐藏 root USER message。拒绝原因是 retry 复用同一输入，默认历史仍需要显示用户最初的问题。

### D9: Hidden 只影响默认历史，不等于模型上下文

选定方案：`hideMessage` 只负责 default history visibility。retry 新 attempt 的模型上下文由 active context/context assembly 规则决定，必须排除上一 attempt 的 assistant/capability 输出，保留 root user input 和必要 retry metadata。

理由：core contracts 已经明确 `visible=false` 不负责移除模型上下文，模型可见上下文由 active context view 控制。如果只隐藏 history 但不处理 model context，retry 会把旧答案当作输入，影响重试质量。

拒绝方案：用 hidden flag 作为模型上下文唯一过滤条件。拒绝原因是 active context 才是模型上下文事实来源，且某些 hidden message 仍可能需要在审计或恢复中可读。

### D10: Visibility failure 不能撤销 retry run

选定方案：retry run queue/scheduler accepted 后，如果 `hideMessage` 暂时不可用，Runtime 必须保留 retry run，并保留可恢复的 replacement anchor：retry run 的 `retryOfRunId`、new request context id、root request id 和 hide idempotency key derivation。Runtime 必须记录 `REQUEST_RETRY_VISIBILITY_UNAVAILABLE` safe diagnostic，并由 recovery/idempotency guard 补做幂等 `hideMessage`。Runtime 不能删除 retry run，不能删除旧 messages，也不能用重新保存 message 内容替代 `hideMessage`。

理由：schedule 成功后，retry 已经是新的 accepted attempt；可见性失败是 history projection 的可恢复缺口，不应破坏 run lifecycle。保留 anchor 后，恢复过程可以重复计算上一 attempt 的 hidden message set 并补做幂等隐藏。

取舍：这个选择可能导致短时间内旧 attempt 和新 attempt 都在默认历史里可见。相比删除 retry run 或提前隐藏旧结果，这个短暂投影缺口更容易恢复，也不破坏 durable lifecycle。

### D11: Accepted retry idempotency 锚定在 retry RequestRun acceptance fact

选定方案：accepted retry decision 不建立独立 command outcome store，也不保存 `RuntimeControlCommandOutcomeRecord`。Runtime 只能在 retry run durable 创建并进入 queued/scheduler accepted 后，依赖该 retry `RequestRun` 自身的 acceptance idempotency anchor 作为重放事实源；相同 key 且相同 command semantic 重放时，Runtime 通过 `RequestRunStoreGateway.loadRunByIdempotencyKey(anchor=ACCEPTANCE)` 读取该 run 并推导同一 `RequestAccepted`。相同 key 但 command semantic 不同返回 `REQUEST_RETRY_IDEMPOTENCY_CONFLICT`。Queue/scheduler 失败前不得形成 accepted retry anchor；rejected retry decision 不新增持久化 outcome 事实，重复命令通过同一目标校验和 safe error 规则稳定重放。

Retry command semantic 至少包含可信 `identityContext.tenantId`、`identityContext.subjectId`、`sessionId`、`expectedLatestRequestId`、`action=RETRY_LATEST` 和 `idempotencyKey`。该 semantic 只来自 Runtime command 字段，不读取 client metadata、隐藏 body 字段、模型输出或 capability input。

理由：accepted decision 过早落点会造成“第一次失败但第二次同 key 直接成功返回旧 runId”的 poisoning。把 accepted retry idempotency 绑定到 retry RequestRun acceptance fact，可以同时满足幂等重放、跨重启恢复和 RequestRun 事实源唯一性；独立 outcome store 会制造与 `RequestRun` 并行的事实源，违反 core contracts 的 gateway 主路径约束。

### D12: Retry 后新 attempt 成为 latest

选定方案：retry run 成功 accepted/queued 后，它成为该 root request 在 agent+owner-scoped session lane 的 latest attempt。后续 cancel 针对这个 retry attempt；后续普通 submit 按 latest-submit replacement 处理这个 retry attempt；后续 retry 必须等该 retry attempt terminal committed 后才能再创建下一 attempt。

理由：retry 不是旁路任务。它会写同一 session 的 terminal/history facts，必须进入 same latest/lane 状态机，否则后续 control command 会无法判断目标。

### D13: SafeError code 使用 retry-specific stable code

选定方案：Runtime retry 至少使用以下稳定 safe code：

- `REQUEST_RETRY_NOT_LATEST`：category `CONFLICT`，`retryable=false`
- `REQUEST_RETRY_NOT_FOUND`：category `NOT_FOUND`，`retryable=false`
- `REQUEST_RETRY_FORBIDDEN`：category `AUTHORIZATION`，`retryable=false`
- `REQUEST_RETRY_NOT_TERMINAL`：category `CONFLICT`，`retryable=false`
- `REQUEST_RETRY_TERMINAL_PENDING`：category `CONFLICT`，`retryable=true`
- `REQUEST_RETRY_ATTACHMENT_UNAVAILABLE`：category `UNAVAILABLE`，`retryable=true`
- `REQUEST_RETRY_QUEUE_UNAVAILABLE`：category `UNAVAILABLE`，`retryable=true`
- `REQUEST_RETRY_IDEMPOTENCY_REQUIRED`：category `VALIDATION`，`retryable=false`
- `REQUEST_RETRY_IDEMPOTENCY_CONFLICT`：category `CONFLICT`，`retryable=false`
- `REQUEST_RETRY_VISIBILITY_UNAVAILABLE`：category `UNAVAILABLE`，`retryable=true`

理由：Channel/Web、observability、测试和日志都需要稳定 code。Retry 的 not terminal、terminal pending、attachment unavailable、queue unavailable 和 visibility unavailable 恢复方式不同，不能混成 generic conflict。

## 质量属性设计（Quality Attributes）

| 质量属性 | 设计结论 | 验证入口 |
|---|---|---|
| 安全 | Retry target selection 必须使用可信 `identityContext.tenantId`、`identityContext.subjectId`、trusted `agentId`、`sessionId` 和 `expectedLatestRequestId`；source attachment refs 必须重新校验 agent+owner scope、`validationStatus=ACCEPTED`、`availabilityStatus=AVAILABLE` 和现有 `RequestAttachmentRecord` metadata；agent/owner mismatch 不泄漏目标是否存在；client metadata/model output/capability args 不能覆盖身份或 Agent Scope；SafeError 不含 raw provider/tool/model/storage/scheduler/attachment/hidden message detail。 | agent+owner-scope negative tests；attachment revalidation tests；SafeError contract tests；redaction code review。 |
| 性能/容量 | Retry 不复制用户 message，不重新保存旧 messages；只创建一个新 run 并隐藏上一 attempt 的非 USER messages；进入既有 scheduler capacity/backpressure，不新增独立执行队列。 | runtime retry characterization tests；scheduler capacity tests；history visibility tests。 |
| 可靠性/恢复 | Retry accepted 晚于 durable queued/scheduler accepted；queue failure terminalizes新 run 为 `FAILED` 且不隐藏旧结果；visibility failure 保留 recovery anchor；accepted idempotency 只从 retry RequestRun acceptance anchor 推导。 | queue failure tests；idempotency poisoning tests；visibility recovery tests；terminal commit tests。 |
| 可维护性 | Runtime 独占 retry lifecycle；Session 只提供 latest/visibility/history policy；Gateway 只存 durable facts；Channel 只转 command/response；Context 只处理 model-visible selection；本 change 不新增 core command/event vocabulary。 | architecture boundary tests；module dependency checks；code review of ownership boundaries。 |
| 可测试性 | target selection、状态矩阵、attempt lineage、scheduler accepted、visibility replacement、active context exclusion、idempotency 和 SafeError 都可用 fake gateway/scheduler/session store deterministic 验证。 | unit tests with fake gateway/session store；contract tests；integration tests using local gateway。 |
| 审计/可追溯性 | 每次 retry 都有独立 `runId`、递增 `attempt` 和 `retryOfRunId`；旧 attempt messages 不删除，只以 `RETRY_REPLACED` hidden metadata 退出默认历史；includeHidden/attempt detail/audit 可追溯。 | attempt lineage assertions；hidden message audit tests；timeline/history tests；audit/log assertions。 |

## 验证映射（Verification Map）

| 约束 | Task | 验证入口 |
|---|---|---|
| Retry 只通过 Runtime command 并校验 agent+owner/latest | T1, T4, T10 | runtime command tests；agent+owner-scope negative tests |
| Terminal committed 状态矩阵 | T1, T4 | runtime retry state tests |
| Same request/new attempt/retryOfRunId lineage | T1, T5 | RequestRun/retry metadata tests |
| Retry 复用 source AgentAssembly | T1, T5 | retry run/context metadata tests |
| Retry 重新校验 source attachments | T1, T5 | attachment revalidation tests |
| Retry accepted 晚于 queued/scheduler accepted | T2, T6 | scheduler accepted tests；command response tests |
| Queue failure terminalizes新 run 且不隐藏旧结果 | T2, T6 | queue failure resilience tests |
| Visibility replacement 晚于 scheduler accepted | T3, T7 | session message visibility tests |
| Hidden 不等于模型上下文 | T3, T8 | active context/context assembly tests |
| Retry RequestRun acceptance idempotency after prerequisites | T2, T9 | duplicate retry/idempotency poisoning tests |
| Retry-specific SafeError code 和 redaction | T10 | SafeError tests；redaction review |
| Channel/Session/Context/Gateway 非职责 | T11 | architecture boundary tests；code review |
| 目标语义和 core-contract check | T12 | cross-change semantic checklist；OpenSpec validation |

## 文档承载决策（Documentation Ownership）

- 行为契约：`openspec/specs/request-retry/spec.md` 主承载 target selection、terminal committed 前置条件、attempt identity、scheduler acceptance、visibility replacement、context exclusion、idempotency 和 SafeError 行为。
- 跨模块架构：`openspec/designs/architecture/runtime-boundaries.md` 主承载 retry command 到 Runtime attachment revalidation、queue/visibility/execution flow 的职责边界，以及 Channel/Session/Context/Gateway/Agent 非职责。
- 领域模型/状态机：`openspec/designs/architecture/request-run.md` 主承载 retry attempt lineage、`retryOfRunId`、same root request、terminal committed retry 前置条件和 queue failure terminalization 不变量。
- 领域历史/可见性：`openspec/designs/modules/agent-session.md` 主承载 retry replacement 对 default history、hidden messages 和 traceability 的影响。
- API/SPI/event/schema：`openspec/designs/architecture/core-contracts.md` 主承载 `RuntimeCommandPort.retryLatest` 返回 `RequestAccepted` 的调用语义、`RequestRunRecord.retryOfRunId?` durable lineage、`SessionMessageStoreGateway.hideMessage` visibility metadata 和 RequestRun persistence consumption。
- 模块职责：`openspec/designs/modules/agent-runtime.md` 主承载 Runtime retry coordinator；`agent-attachment-runtime` 主承载 source attachment refs 重新校验；`agent-session` 主承载 latest-ended/visibility policy；`agent-channel-web` 主承载 command adapter 非职责；`agent-context-engine` 主承载 active context consumption boundary。
- ADR：`openspec/designs/adr/request-retry-replacement-attempt.md` 主承载 same request/new attempt、schedule 成功后隐藏旧结果、失败不恢复旧结果可见性的长期取舍。
- 导航：`openspec/designs/spec-to-design-map.md` 主承载 `request-retry` 到设计和测试入口的导航。

## 风险与取舍（Risks / Trade-offs）

- [风险] `RequestAccepted` 被 UI 误解为 retry 已完成。-> spec/design 明确 `RequestAccepted` 只表示 retry run 已被 Runtime 接受并进入 queued/scheduler path，terminal 仍来自 Runtime terminal facts。
- [风险] Visibility replacement 失败导致短时间双结果可见。-> 保留 retry recovery anchor，记录 `REQUEST_RETRY_VISIBILITY_UNAVAILABLE` safe diagnostic，由 recovery/idempotency guard 幂等补做 `hideMessage`。
- [风险] Retry 和 edit-resubmit 混淆。-> retry 保持同 root request；edit-resubmit 才创建新 root USER message。
- [风险] Retry 重新解析 AgentAssembly 导致结果不可复现。-> retry 固定复用 source run 的 resolved assembly。
- [风险] 原 request 的 attachment refs 已过期或跨 agent/owner 不再可见。-> retry accepted 前重新校验 attachment refs，失败时返回 `REQUEST_RETRY_ATTACHMENT_UNAVAILABLE` 或 agent/owner-scope safe error，不创建 retry run、不隐藏旧结果。
- [风险] Queue failure 后留下半活跃 retry run。-> queue/scheduler failure 必须 terminalize 新 run 为 `FAILED`，且不隐藏旧结果、不形成 accepted retry anchor。
- [风险] `hideMessage` 被误用为模型上下文过滤。-> spec 明确 hidden 只影响默认历史，active context 才定义模型可见消息。
- [风险] Visibility policy 被误用为删除历史。-> retry run、`retryOfRunId`、hidden message 和 visibility audit 都是持久化事实；默认历史可隐藏旧结果，但 trace/debug/audit 仍可解释，不能通过策略回滚删除。
- [风险] 控制接受结果与 core contracts 的 `RequestAccepted` 混淆。-> 设计明确以 `stable ts-core-contracts` 为准，retry 成功返回 `RequestAccepted`。

## 归档前更新基线（Baseline Promotion Plan）

- `openspec/specs/request-retry/spec.md`：提升 request retry 可验证行为契约。
- `openspec/overview.md`：提升 retry 对瞬时失败恢复、连续操作体验和历史可追溯性的长期背景。
- `openspec/designs/architecture/runtime-boundaries.md`：提升 Runtime-owned retry flow、source attachment revalidation、scheduler accepted boundary、visibility replacement boundary 和跨模块非职责。
- `openspec/designs/architecture/request-run.md`：提升 retry attempt lineage、same root request identity、terminal committed retry 前置条件和 queue failure terminalization 不变量。
- `openspec/designs/modules/agent-session.md`：提升 retry replacement visibility、hidden message traceability 和 default history 语义。
- `openspec/designs/architecture/core-contracts.md`：提升 `RuntimeCommandPort.retryLatest` 调用语义、`RequestAccepted` 边界和 SafeError 分支。
- `openspec/designs/architecture/core-contracts.md`：提升 retry 使用 RequestRun persistence 和 `hideMessage` 的持久化语义。
- `openspec/designs/modules/agent-runtime.md`：提升 Runtime retry coordinator 职责。
- `openspec/designs/modules/agent-attachment-runtime.md`：提升 retry source attachment refs 重新校验职责。
- `openspec/designs/modules/agent-session.md`：提升 latest-ended policy 和 retry visibility policy 职责。
- `openspec/designs/modules/agent-channel-web.md`：提升 Web retry command/projection 非职责。
- `openspec/designs/modules/agent-context-engine.md`：提升 retry active context exclusion consumption boundary。
- `openspec/designs/adr/request-retry-replacement-attempt.md`：提升 retry replacement attempt 的长期取舍。
- `openspec/designs/spec-to-design-map.md`：提升导航和验证入口。

## 待确认问题（Open Questions）

无。当前设计在本批 active changes 内收敛边界：共享 RequestRun agent+owner scope 基础由 `add-ts-session-lane-scheduling` 承载；retry 专属 lineage、visibility 和 attachment revalidation refinements 由本 change 承载。
