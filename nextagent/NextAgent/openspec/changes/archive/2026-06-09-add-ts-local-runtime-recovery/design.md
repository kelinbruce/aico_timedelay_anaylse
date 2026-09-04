## 背景和现状（Context）

`stable ts-backend-architecture` 已经把 request lifecycle、scheduler、same-session lane、checkpoint、terminal commit 和 canonical timeline 归给 `agent-runtime`。`stable ts-core-contracts` 已经提供 `RequestRun.version`、`claimRun`、`listRecoverableRuns`、`commitTerminal`、checkpoint payload、`RequestContext` 恢复坐标、`CapabilityReplayPolicy` 和 gateway Record 边界。`add-ts-session-lane-scheduling` 明确 durable `RequestRun.status=QUEUED` 是权威排队事实，scheduler pending queue 是可重建调度结构。`add-ts-runtime-recovery-idempotency-guard` 明确 pending Tool replay 的安全门。

本 change 承载的目标问题是：本地进程重启后，Runtime 应该如何从 durable facts 恢复 queued、executing 和 terminal-pending run。目标语义要求 Runtime 扫描 queued/executing/terminal-pending run；queued run 重新 schedule work；executing run 先 reconcile partial terminal，再 claim，然后按 checkpoint/messages 重建 context；terminal pending run 执行 terminal takeover；recovered Tool path 必须通过 pending Tool replay guard 拒绝非幂等 replay。

目标契约以 OpenSpec core contracts 为准，`RequestContext` 不保存 `messageRefs`、`attempt` 或 `deadlineAt`；`attempt`/`deadlineAt` 仍来自 `RequestRun`，current request/run messages 从 message store 读取，pending Tool safety 通过 `CapabilityReplayPolicy + idempotencyKey` 契约和 guard change 表达。

本 change 定义本地启动恢复 orchestrator、scheduler dispatch gating、queued rebuild、executing claim/reconstruction、terminal takeover/reconcile 和 recovery failed terminalization 的目标流程；实施任务围绕这些目标流程建立验证和接入。

## 目标和非目标（Goals / Non-Goals）

**目标：**

- 在本地单实例 Runtime 启动后执行一次 bounded recovery pass，并在完成前 gate scheduler dispatch。
- 通过 durable `RequestRun`、checkpoint、message、timeline 和 terminal commit facts 恢复本地状态。
- 对 `QUEUED` run 重建 scheduler work item，不 inline 执行。
- 对 `EXECUTING` run 先 terminal reconcile，再 claim/fence，再按 checkpoint/messages/context facts 恢复。
- 对 terminal pending/retrying run 做幂等 terminal takeover。
- 对 partial terminal facts 做 reconcile，不重复写 terminal message/event。
- 对无法证明安全恢复的 run 通过 terminal commit boundary 收敛为 recovery failed / safe error。
- 保持 `AgentAssemblyRegistry.require(run.agentId, run.agentVersion)` 的冻结 assembly 语义。
- 复用 `add-ts-runtime-recovery-idempotency-guard` 处理 pending Tool replay，不在本 change 重新定义 Tool replay 规则。

**非目标：**

- 不实现 PaaS 多实例 shared state、lock/lease、worker registry、non-sticky routing 或跨进程 takeover。
- 不新增 Web API、RuntimeCommand、StreamEventType、TimelineEventType、RunStatus 或用户可见恢复操作。
- 不定义具体 SQLite schema、索引、文件布局、remote gateway endpoint 或 adapter-private query。
- 不改变 retry/edit/cancel 的用户语义；这些 command 只消费恢复后稳定的 Runtime facts。
- 不绕过 capability replay policy；不把非幂等 Tool 重放作为恢复策略。

## 设计决策（Decisions）

### D1: 启动期 bounded recovery pass 是唯一选定流程

选定方案：`agent-app` 装配 Runtime 后，Runtime 在 scheduler 开始 dispatch 前调用 local recovery orchestrator。orchestrator 使用有限 batch limit 调用 `RequestRunStoreGateway.listRecoverableRuns`，处理 `QUEUED`、`EXECUTING` 和 terminal pending/retrying facts。恢复 pass 结束后才允许 scheduler drain pending work。

理由：本地进程重启时，最危险的是旧内存状态丢失但 durable facts 仍阻塞 lane。启动期先恢复可以避免新 work 抢在 terminal reconcile 或 queued rebuild 前执行。该方案与 architecture 的“本地只承诺单实例进程重启恢复”一致，也避免把 PaaS lock/lease 提前引入。

拒绝方案：后台常驻 recovery poller。拒绝原因是它会把本地单实例恢复扩大成调度子系统，容易与 PaaS shared-state recovery 混在一起。

拒绝方案：重启后一律把 active run 标为 failed/canceled。拒绝原因是 queued run 和 terminal pending run 明明有可恢复事实，一律失败会破坏已接受请求和 terminal commit 的可靠性；标为 canceled 还会把系统故障伪装成用户行为。

### D2: Recovery 逻辑顺序以 terminal correctness 为优先

选定方案：每个 recoverable run 的处理顺序固定为：先检查 terminal-pending 或 partial terminal facts；能 terminal takeover/reconcile 的先收敛终态。只有没有 terminal facts 可收敛时，才按 `QUEUED` 或 `EXECUTING` 路径恢复。

理由：terminal message/event 一旦持久化，就比内存执行状态更接近事实来源。先终态收敛可以避免 duplicate terminal message/event，也避免 same-lane 新 work 在旧 terminal 未稳定时执行。

目标效果：扫描 queued/executing/pending terminal 时，TS 设计不要求暴露具体内部循环顺序，而要求达到“terminal facts 优先收敛、dispatch 被 gating”的效果。

### D3: `QUEUED` 只 rebuild scheduler work，不直接执行

选定方案：queued recovery 校验 assembly、current request messages 和 agent+owner-scoped facts 后，只创建 scheduler work item。该 work item 后续仍走 normal scheduler dispatch、lane snapshot、capacity、claim/fencing 和 terminal-pending protection。

理由：`add-ts-session-lane-scheduling` 已经确定 durable queued facts 是权威队列，scheduler pending queue 是可丢失可重建结构。recovery 的职责是把丢失的 pending queue 补回来，不是绕过 scheduler。

拒绝方案：recovery scan 中直接调用 Agent execution。拒绝原因是它绕过 scheduler dispatch gate，可能破坏同 lane 串行和全局 backpressure。

### D4: `EXECUTING` 必须 claim/fence 后继续

选定方案：executing recovery 先尝试 `claimRun(expectedVersion, lockedBy, lockExpiresAt)` 或等价 CAS。claim 成功后才读取 checkpoint/current messages/timeline/active context 并恢复执行。claim conflict 是正常控制结果：当前 recovery worker 跳过或 reload，不把 run 立即标 failed。

理由：即使本 change 只承诺本地单实例，core contracts 已经要求 version/claim/fencing 作为恢复和未来 PaaS 的最小并发语义。用 claim 作为恢复入口，既能防止重复执行，也避免后续多实例改造时推翻本地实现。

拒绝方案：本地恢复因为单实例就不做 claim。拒绝原因是它会让恢复语义依赖“绝对没有第二个执行者”的隐含假设，违反 core contracts 的 recovery 边界。

### D4A: Recovery-specific gateway facts 保留 agent scope

选定方案：本 change 消费 `add-ts-session-lane-scheduling` 固定的 RequestRun 主路径 agent+owner scope 基础，并在 recovery-specific gateway 操作中继续保留该 scope。`listRecoverableRuns`、`claimRun`、`CheckpointStoreGateway.loadCheckpoint`、terminal takeover/reconcile 所需事实和 current request/run message 查询，都必须以可信 `tenantId`、`subjectId`、`agentId` 及 session/request/run 坐标过滤或返回；Runtime 不得用 adapter-private SQL 或 owner-only lookup 绕过 gateway contract。

理由：recovery 是重启后的主路径事实修复，最容易被实现成本地 adapter 私查。若 recoverable scan 或 checkpoint load 丢失 `agentId`，同一 owner 下不同 Agent 的 run、checkpoint、message 或 terminal facts 可能被串联，后续 assembly 恢复和 lane release 都会错误。

拒绝方案：为了本地恢复方便，只按 `tenantId + subjectId + sessionId/runId` 或 adapter-private row id 查找。拒绝原因是它绕过 Agent Scope，且会让 local recovery 与 request control/scheduler 使用不同的主路径 scope 原则。

### D5: `RequestContext` 从 checkpoint 和消息重建，保持最小恢复坐标

选定方案：recovery 只恢复 core contracts 定义的 `RequestContext` 字段：`requestContextId`、`sessionId`、`requestId`、`runId`、`identityContext`、`locale`、`agentId`、`agentVersion`、`agentAssemblyRef`、`activeStepId?`、`nextLifecycleStage`、`currentToolBatchMessageId?`、`toolCallStates`、`flowVariables`。`attempt`、`deadlineAt` 来自 `RequestRun`；current run messages 按 `sessionId/requestId/runId` 从 message store 读取。

checkpoint 对账必须考虑 recovery claim/fencing 会推进 `RequestRun.version`：checkpoint 覆盖的是 claim 前的执行边界，因此 checkpoint `runVersion` 可以等于 claim 后 `RequestRun.version - 1` 或当前版本，但不得早于 claim 前版本，也不得指向未来版本。`activeContextVersion` 只用于证明 checkpoint 没有引用未来 active context；current active context 允许因为 checkpoint 之后已经持久化的 result/message 事实而更新，但 message、timeline、run stage 仍必须能与 checkpoint 边界对账。

当 `nextLifecycleStage=BEFORE_CAPABILITY_INVOKE` 时，assistant tool-use message 必须已经被 checkpoint 边界覆盖；如果 tool-use message 的持久化时间晚于 checkpoint，Runtime 不能把它当作可恢复 pending Tool 边界继续执行，必须 fail closed。

理由：stable core contracts 已明确 `RequestContext` 是可恢复执行坐标；`messageRefs`、`attempt` 和 `deadlineAt` 不属于该坐标的持久字段。恢复逻辑必须从 `RequestRun` 和 message store 读取这些事实，而不是扩大 `RequestContext` contract。

### D6: Lifecycle stage 决定恢复继续点

选定方案：

- `BEFORE_MODEL_INVOKE`：如果没有持久化 assistant result，重新发起模型调用；如果已经有 assistant fact，使用持久化事实继续判断下一步。
- `BEFORE_CAPABILITY_INVOKE`：先从 assistant tool-use message 和 capability result messages 重建每个 Tool 状态；已有 result 的复用；缺 result 的 pending Tool 调用 `runtime-recovery-idempotency-guard`。
- `BEFORE_TERMINAL_EVENT`：进入 terminal commit boundary，使用幂等 terminal commit。

理由：这三个 stage 已经是 core contracts 定义的可恢复执行点。新增 stage 或 recovery-only stream/timeline event 会扩大 public vocabulary，不符合本 change 范围。

### D7: Frozen assembly 只能用 `require(agentId, agentVersion)`

选定方案：恢复任何 accepted run 都必须用 run 中固化的 `agentId`、`agentVersion`、`agentAssemblyRef`。assembly lookup 只能调用 `AgentAssemblyRegistry.require(run.agentId, run.agentVersion)`。

理由：stable architecture/core contracts 明确 `active(agentId)` 只用于 request acceptance。恢复时 fallback 到最新 active version 会让同一已接受请求换 agent 继续跑，破坏审计、重现和 capability contract。

拒绝方案：missing assembly 时 fallback 到 default/latest active Agent。拒绝原因是它会把恢复失败变成静默行为漂移。

### D8: Recovery failed 必须走 terminal commit boundary

选定方案：缺 messages、缺 checkpoint、checkpoint/message/timeline mismatch、missing assembly、Tool guard 拒绝、无法安全 reconcile 的 terminal facts 都收敛为 failed terminal outcome。该 outcome 必须通过 terminal commit 语义持久化；如果 terminal commit pending/retrying，lane 继续 blocked。

理由：只改 `RequestRun.status=FAILED` 不足以保证 stream/history/timeline 一致。terminal commit 是用户可见终态、canonical timeline 和 lane release 的共同边界。

拒绝方案：裸写 run failed 并立即 release lane。拒绝原因是它会制造 read model 和 terminal facts 分裂。

### D9: `ACCEPTED` 作为条件范围处理

选定方案：如果实现存在持久化 `ACCEPTED` 但尚未 queued 的窗口，recovery 把它当 pre-queue repair：facts 完整则修复到 queued path，facts 不完整则 recovery failed。若实现采用 accept->queued 原子写入，则必须用 characterization test 证明不会出现 durable `ACCEPTED` recoverable window。

理由：当前 local recovery 输入文档主要写 `QUEUED` 和 `EXECUTING`，但 core lifecycle 中存在 `ACCEPTED` vocabulary。这个设计把边界说清楚，不强迫实现制造一个不存在的中间态，也不遗漏已有中间态的 crash window。

## 质量属性设计（Quality Attributes）

| 质量属性 | 设计结论 | 验证入口 |
|---|---|---|
| 安全 | 恢复 Agent Scope 和 Owner Scope 来自 durable gateway facts 和 trusted runtime context；不从客户端 metadata、模型输出或 Tool arguments 推导 agent、owner、assembly 或 replay eligibility；missing assembly fail closed。 | agent+owner-scope recovery tests；missing assembly negative test；code review 检查 `active(agentId)` 不在恢复路径使用。 |
| 性能/容量 | 启动恢复使用 finite batch limit，不做 unbounded loop；queued rebuild 只补 scheduler work，不 inline 执行；不同 lane 的后续 dispatch 仍由 scheduler capacity 控制。 | bounded recovery tests；scheduler rebuild tests；code review 检查无全局无限扫描。 |
| 可靠性/恢复 | terminal facts 优先；claim/fencing 防重复执行；checkpoint/message/timeline 对账；pending Tool 交给 guard；unsafe path terminal failed；terminal commit 幂等。 | recovery characterization tests；terminal takeover/reconcile tests；pending Tool guard handoff tests。 |
| 可维护性 | Runtime 是唯一 recovery state machine owner；Gateway 只返回 `*Record` 和 CAS result；Session/Context/Capability/Core 不复制恢复状态机。 | architecture lint；module boundary code review；fake gateway contract tests。 |
| 可测试性 | 每个恢复分支都能用 fake gateway/session/checkpoint/assembly/capability 构造 deterministic case；错误码稳定，可做 snapshot/contract 测试。 | Vitest unit/contract tests；negative tests；OpenSpec strict validation。 |
| 审计/可追溯性 | recovery outcome 使用稳定 code、run/stage/capability/toolCall 关联和 terminal outcome；诊断脱敏，不记录 prompt、模型输出、raw Tool args/result、credential、path、raw idempotency key。 | SafeError/redaction tests；observability assertion tests；secret scan。 |

## 验证映射（Verification Map）

| 约束 | Task | 验证入口 |
|---|---|---|
| 启动恢复完成前 gate scheduler dispatch | 1.1, 2.1 | startup recovery characterization tests |
| recoverable scan 使用 bounded durable facts | 1.2, 2.2 | gateway recovery contract tests；bounded scan tests |
| queued rebuild 不 inline execution | 1.3, 2.3 | scheduler rebuild tests；executor call count assertions |
| executing claim/fencing 后才能继续 | 1.4, 2.4 | claim accepted/conflict tests |
| context 从 checkpoint/messages 重建 | 1.5, 2.5 | context reconstruction tests |
| pending Tool 交给 idempotency guard | 1.6, 2.6 | guard handoff tests；non-idempotent replay negative tests |
| terminal pending/retrying takeover 幂等 | 1.7, 2.7 | terminal takeover duplicate-prevention tests |
| partial terminal facts reconcile | 1.8, 2.8 | partial terminal reconcile tests |
| missing assembly 不 fallback | 1.9, 2.9 | missing assembly test；`rg "active("` recovery-path review |
| recovery failed 通过 terminal boundary | 1.10, 2.10 | terminal failed/lane release tests |
| diagnostics 脱敏和稳定错误码 | 1.11, 2.11 | SafeError/redaction tests |
| target semantic alignment | 3.1, 3.2, 3.3 | OpenSpec cross-check；cross-change semantic review |

## 文档承载决策（Documentation Ownership）

- 行为契约：`openspec/specs/local-runtime-recovery/spec.md` 主承载 startup recovery、queued rebuild、executing recovery、terminal takeover、safe fail 和 diagnostics。
- 跨模块架构：`openspec/designs/architecture/runtime-recovery.md` 主承载 local recovery flow、scheduler dispatch gating、Gateway facts 边界、local/PaaS 分层和质量属性。
- 领域模型/状态机：`openspec/designs/architecture/request-run.md` 主承载 recoverable run、terminal-pending、recovery failed terminal outcome、lane release 不变量。
- API/SPI/event/schema：`openspec/designs/architecture/core-contracts.md` 主承载 `listRecoverableRuns`、`claimRun`、`commitTerminal`、checkpoint、`RequestContext` 和 `CapabilityReplayPolicy` 在 recovery 中的调用语义；共享 RequestRun scope 基础引用 session-lane change，不在本 change 重复定义平行 DTO。
- 模块职责：`openspec/designs/modules/agent-runtime.md` 主承载 Runtime recovery owner；`openspec/designs/modules/agent-platform-gateway-local.md` 主承载 local facts/CAS/terminal adapter 职责；`openspec/designs/modules/agent-session.md` 主承载 current request/run message facts。
- ADR：`openspec/designs/adr/local-runtime-recovery-startup-gate.md` 记录选择 startup bounded pass 和 fail-closed 策略的长期取舍。
- 导航：`openspec/designs/spec-to-design-map.md` 增加 `local-runtime-recovery` 到上述文档和验证入口的链接。

## 风险与取舍（Risks / Trade-offs）

- [恢复 pass 阻塞启动 readiness] -> 只 gate scheduler dispatch 和 command readiness，不要求进程无法启动；bounded batch 防止无限阻塞。
- [具体扫描顺序与 TS 设计表述不同] -> TS 以 terminal correctness 效果为准：scheduler dispatch gated，terminal facts 优先收敛；不把内部 loop 顺序暴露成 public contract。
- [ACCEPTED 中间态不确定] -> 用条件范围收敛：存在 durable window 就 repair/fail；原子写入就用 characterization test 证明 non-goal。
- [过度 fail closed 导致可恢复请求失败] -> 只在缺必要 facts、facts 冲突或 Tool guard 拒绝时 failed；queued、terminal pending、已有 result、before model replay 都按可恢复路径处理。
- [恢复不可用时引入临时手工修复接口] -> 本 change 不定义 ad hoc mutation/admin repair API；无法安全自动恢复的 stuck run 必须通过显式后续 repair/admin change 处理，且不得删除已提交 terminal facts。
- [诊断不足] -> 稳定错误码区分 missing messages、missing checkpoint、checkpoint mismatch、missing assembly、terminal facts inconsistent、claim conflict 和 Tool guard codes，同时强制 redaction。
- [未来 PaaS 需要重构] -> 本地实现仍使用 version/claim/fencing/terminal commit contract，不依赖 process-local correctness；PaaS 只需替换共享 state/lock/lease，不推翻本地恢复语义。

## 归档前更新基线（Baseline Promotion Plan）

- `openspec/specs/local-runtime-recovery/spec.md`：提炼本 change 的 ADDED requirements。
- `openspec/overview.md`：提炼本地重启恢复对电信网络长任务可靠性和运维诊断的长期意义。
- `openspec/designs/architecture/runtime-recovery.md`：提炼 startup recovery flow、dispatch gating、terminal correctness、local/PaaS 分层和质量属性。
- `openspec/designs/architecture/request-run.md`：提炼 recoverable run 分类、terminal-pending、recovery failed、lane release 和 attempt/assembly 不变量。
- `openspec/designs/architecture/core-contracts.md`：提炼 recovery 对 `RequestRunStoreGateway`、`CheckpointStoreGateway`、terminal commit、`RequestContext` 和 capability replay policy 的调用语义。
- `openspec/designs/modules/agent-runtime.md`：提炼 recovery orchestrator、scheduler rebuild、claim/takeover、terminal reconcile 和 safe failure owner 职责。
- `openspec/designs/modules/agent-platform-gateway-local.md`：提炼 local adapter 的 durable facts/CAS/terminal idempotency 职责。
- `openspec/designs/modules/agent-session.md`：提炼 current request/run messages 和 history facts 供 recovery 消费的职责。
- `openspec/designs/adr/local-runtime-recovery-startup-gate.md`：记录 startup bounded pass、terminal-first、fail-closed 和 no PaaS scope 的取舍。
- `openspec/designs/spec-to-design-map.md`：增加 spec 到 design/test 的导航。

## 待确认问题（Open Questions）

无。`ACCEPTED` 已按条件范围处理：实现存在 durable pre-queue window 就 repair/fail；实现保证 accept-to-queued 原子写入就用 characterization test 固化 non-goal。
