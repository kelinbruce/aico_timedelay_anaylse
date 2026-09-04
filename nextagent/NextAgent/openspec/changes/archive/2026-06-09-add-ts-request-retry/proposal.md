## 背景与问题（Why）

NextAgent TS 后端已经通过 `stable ts-backend-architecture` 和 `stable ts-core-contracts` 确定：`agent-runtime` 是 request lifecycle 的唯一 owner，负责 request submit、cancel、retry、edit、scheduling、same-session lane、latest-request handling、terminal commit 和 canonical timeline publication。`add-ts-session-lane-scheduling` 进一步明确 submit 会先创建 durable queued run，再由 Runtime scheduler 按 agent+owner-scoped session lane 串行 dispatch，并用 terminal-pending 保护防止后续执行提前写入同一会话的 terminal/history facts。`add-ts-request-cancel` 已经固化用户主动取消的 terminal boundary、idempotency 和 SafeError 风格。

当前缺口是：用户遇到瞬时模型失败、外部依赖抖动或输出质量不稳定时，需要对当前会话最近一次已结束请求直接 retry，而不是重新输入同一问题。retry 不能被实现成前端再次 submit 一条新消息，也不能只复制旧输入后绕过 Runtime。否则系统会丢失同一请求的 attempt 关系、让旧结果无法追溯，或在旧 terminal commit 未稳定时提前启动新执行，破坏 session lane、history 和 recovery 语义。

本 change 现在处理 request retry，是为了让“对最近已结束请求创建新的执行尝试”具备可验证的端到端语义：Runtime 校验 agent+owner scope、latest request、terminal committed 和 idempotency 后，为同一个 root request 创建新的 `RequestRun` attempt，成功 queued/scheduled 后隐藏旧 attempt 的默认历史结果，但保留旧结果和 attempt lineage 可追溯。

## 变更范围（What Changes）

- 新增 request retry 行为契约：用户 retry 当前 agent+owner-scoped session lane 的 latest 已结束请求时，Runtime 必须通过 `RuntimeCommandPort.retryLatest(command: RequestControlCommand)` 处理。
- 定义 retry command idempotency 前置条件：Runtime command boundary 必须收到非空 canonical `idempotencyKey`；本 change 不定义 public Web DTO 的 key 来源，只定义 Runtime 对该 key 的校验、重放和冲突语义。
- 定义 retry 目标选择：Runtime 使用可信 `identityContext.tenantId`、`identityContext.subjectId`、`sessionId` 和 `expectedLatestRequestId` 定位当前 latest request；不支持任意历史 request retry。
- 定义 retry 适用状态：latest run 必须是 terminal 且 `terminalCommitState=COMMITTED`；`ACCEPTED`、`QUEUED`、`PLANNING`、`EXECUTING` 和 terminal-pending run 不可 retry。
- 定义 retry attempt identity：retry 复用原始 root request/message，即 `requestId` 不变；Runtime 创建新的 `runId`，将 `attempt` 递增，并设置 `retryOfRunId` 指向被替换的前一次 attempt。连续 retry 时，每次新 attempt 指向上一 attempt。
- 定义 source attachment 重新校验：retry 复用原 root USER message 的 attachment refs，但 Runtime 在接受 retry 前必须通过 attachment boundary 重新校验 attachment refs 的 agent+owner scope、可用性和安全 descriptor；校验失败时不创建 retry run、不隐藏旧结果。
- 定义 retry acceptance boundary：`RuntimeCommandPort.retryLatest` 成功时返回 `RequestAccepted(sessionId, requestId, runId, attempt)`；该结果表示 retry run 已 durable 创建并成功进入 queued/scheduler accepted 状态，不表示 Agent execution 已完成。
- 定义 retry scheduling：retry run 进入与普通 submit 相同的 agent+owner-scoped session lane 和 Runtime scheduler，不绕过 queue、terminal-pending protection、capacity limit 或 recovery boundary。
- 定义旧结果可见性替换：retry run 成功 queued/scheduled 后，Runtime 必须通过 `SessionMessageStoreGateway.hideMessage(HideMessageRequest)` 幂等隐藏旧 attempt 的非 USER messages，使默认历史视图展示新 attempt 结果；不得通过重新保存整条 message 或私有 update 改写 visibility。旧消息仍可通过 includeHidden、attempt detail 或 audit 追溯。
- 定义 active context 边界：`hideMessage` 只影响默认历史视图；retry 新 attempt 的模型上下文不得把旧 attempt 的 assistant/capability 输出当作普通可见历史输入，必须通过 active context/session/context selection 规则排除。
- 定义 retry idempotency 和失败收敛：同一 `idempotencyKey` 与同一 command semantic 的重复 retry 通过新 retry `RequestRun` 的 acceptance idempotency anchor 恢复同一 `RequestAccepted`，不创建第二个 run；相同 key 不同 command semantic 返回 `REQUEST_RETRY_IDEMPOTENCY_CONFLICT`；accepted outcome 只能在 retry run 已成功 queued/scheduled 后由 durable RequestRun acceptance fact 推导。若 retry run 半途创建但 queue/scheduler 失败，Runtime 必须 terminalize 该新 run 为 `RunStatus.FAILED`，不隐藏旧结果、不形成 accepted retry anchor。
- 定义 retry SafeError：Runtime 必须使用 retry-specific stable code 映射 stale latest、not found、forbidden、not terminal、terminal pending、attachment unavailable、queue unavailable、idempotency required、idempotency conflict 和 visibility unavailable 分支，并保证 safeDetails 不泄漏 owner、store、scheduler、attachment、hidden message、raw model/tool input、credential、stack 或本地路径。
- 定义跨 agent/owner 协作边界：Channel 只向 Runtime command boundary 提供可信 identity 和 canonical idempotency、构造 `RequestControlCommand(action=RETRY_LATEST)` 并返回 Runtime 的 `RequestAccepted` 或 SafeError；Gateway 只提供 agent+owner-scoped durable facts、queue/terminal/write facts 和 `hideMessage`；Session/Context 只维护 history/context 语义；Agent/Core/Model/Capability 只执行 Runtime 分配的新 run，不拥有 retry lifecycle；public Web DTO 的 key 来源不属于本 change 职责。
- 定义相关非目标：不实现 edit-resubmit 语义、不实现完整 local runtime recovery、多实例 lock/lease、stream replay 机制、attempt history UI、复杂前端按钮状态、数据库 schema 细节或任意历史 request retry。

## Capability 影响（Capabilities）

### 新增 Capability

- `request-retry`: 定义 Runtime retry 当前 latest 已结束 request 的 agent+owner scope、目标选择、terminal committed 前置条件、same-request new-attempt identity、source attachment 重新校验、scheduler/queue 接入、旧结果 visibility replacement、active context 边界、idempotency、SafeError 和跨模块边界。

### 修改的 Capability

- `ts-core-contracts` / `agent-contracts/gateway`：在不新增 RuntimeCommand、RunStatus、TimelineEventType、StreamEventType 或 retry 专属 gateway port 的前提下，承接 retry 专属的持久化 contract refinement：`RequestRunRecord.retryOfRunId?` 必须可 durable 保存和读取，`SessionMessageStoreGateway.hideMessage` 必须支持 retry replacement 的 idempotent visibility metadata，retry source attachment 重新校验必须消费 agent+owner-scoped attachment boundary。共享 RequestRun lookup/claim/terminal commit scope 与 `RequestRunStoreGateway.loadRunByIdempotencyKey(anchor=ACCEPTANCE)` 基础由 `add-ts-session-lane-scheduling` 承载，本 change 不重复定义。

## 影响范围（Impact）

- `agent-runtime`：实现 retry target selection、terminal committed 校验、canonical `idempotencyKey` 校验、new attempt creation、lane/scheduler enqueue、通过 retry run acceptance anchor 恢复重复 accepted outcome、SafeError mapping、queue failure terminalization、visibility replacement trigger 和 recovery handoff。
- `agent-attachment-runtime`：为 retry 复用的原 root USER message attachment refs 提供 agent+owner-scoped availability/safe-descriptor 重新校验；不决定 retry lifecycle。
- `agent-session`：提供 latest-ended policy、retry visibility policy、history/read model 语义和 default history hidden-message 行为；不决定 retry lifecycle。
- `agent-platform-gateway-*`：通过既有 RequestRun/timeline/session message logical ports 保存 retry run、`retryOfRunId` lineage、queue facts、terminal facts 和 hidden-message visibility metadata；不决定 retry legality。
- `agent-channel-web`：接收 Web/API retry command、向 Runtime command boundary 提供可信 identity 和 canonical idempotency、调用 Runtime command boundary，并返回 `RequestAccepted` 或 SafeError；不判断 latest、terminal、queue、hide 或 context，也不定义 public Web DTO key 来源。
- `agent-context-engine` / active context consumer：确保 retry 新 attempt 的模型上下文不自动包含旧 attempt 的 assistant/capability 输出。
- `agent-core`、`agent-model`、`agent-capability-*`：执行 Runtime 分配的新 retry run；不得发布 request terminal lifecycle event 或决定 retry visibility。
- 测试：新增 Runtime retry characterization tests、agent+owner-scope/latest negative tests、source attachment revalidation tests、scheduler/queue failure tests、visibility replacement tests、active context exclusion tests、idempotency tests、SafeError tests、目标语义一致性检查和 OpenSpec strict validation。

## 归档前更新基线（Baseline Promotion Plan）

行为契约：

- `openspec/specs/request-retry/spec.md`：新增 request retry 的 target selection、terminal committed 前置条件、same-request new-attempt identity、source attachment 重新校验、scheduler/queue acceptance、visibility replacement、active context、idempotency、SafeError 和跨模块边界。

长期背景：

- `openspec/overview.md`：补充 retry 对电信网络智能体长任务瞬时失败恢复、用户连续操作体验和历史可追溯性的意义。

设计视图：

- `openspec/designs/architecture/runtime-boundaries.md`：补充 retry command -> owner/latest validation -> new attempt creation -> queued/scheduler accepted -> visibility replacement -> execution/terminal 的 Runtime 边界。
- `openspec/designs/architecture/request-run.md`：补充 retry attempt lineage、`retryOfRunId`、same root request identity、terminal committed retry 前置条件和 queue failure terminalization 不变量。
- `openspec/designs/modules/agent-session.md`：补充 retry replacement 对 default history visibility、hidden message audit 和 includeHidden/attempt detail 的影响。
- `openspec/designs/architecture/core-contracts.md`：补充 `RuntimeCommandPort.retryLatest` 使用 `RequestControlCommand` 并返回 `RequestAccepted` 的调用语义和 SafeError 分支。
- `openspec/designs/architecture/core-contracts.md`：补充 retry 使用既有 RequestRunStoreGateway、`RequestRunRecord.retryOfRunId?`、SessionMessageStoreGateway.hideMessage 和 agent+owner-scoped gateway requests 的持久化语义。
- `openspec/designs/modules/agent-runtime.md`：补充 Runtime retry owner 职责、scheduler enqueue、retry RequestRun acceptance idempotency anchor consumption 和 visibility replacement trigger。
- `openspec/designs/modules/agent-attachment-runtime.md`：补充 retry source attachment refs 重新校验职责。
- `openspec/designs/modules/agent-session.md`：补充 latest-ended policy、retry visibility policy 和 session history hidden-message 语义。
- `openspec/designs/modules/agent-channel-web.md`：补充 Channel 只调用 Runtime retry command 并返回 `RequestAccepted`/SafeError 的职责。
- `openspec/designs/adr/request-retry-replacement-attempt.md`：记录选择 same request/new attempt、schedule 成功后隐藏旧结果、失败不恢复旧结果可见性的取舍。
- `openspec/designs/spec-to-design-map.md`：新增 `request-retry` 到 architecture/domain/contracts/modules/ADR/验证入口的导航。

验证入口：

- `request-retry` spec scenarios。
- Runtime characterization tests for terminal committed retry、same request new attempt、continuous retry lineage、source attachment revalidation、scheduler queued acceptance、queue failure terminalization、visibility replacement timing 和 retry RequestRun acceptance idempotency。
- Owner-scope/latest-request negative tests。
- Session/history tests for hidden old assistant/capability messages and old result traceability。
- Active context tests ensuring old attempt output is excluded from retry model context.
- SafeError tests for retry-specific stable codes and redaction.
- 目标语义一致性检查，覆盖 latest 校验、terminal committed 前置、same root retry run、`retryOfRunId`、scheduler success 后 retry run acceptance idempotency anchor、schedule 成功后 visibility replacement、queue failure terminalization，以及 TS 按 core contracts 返回 `RequestAccepted`。
- `openspec validate add-ts-request-retry --strict`。
