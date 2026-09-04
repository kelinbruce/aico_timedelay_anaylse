## 背景和现状（Context）

`stable ts-backend-architecture` 已经规定 `agent-runtime` 拥有 request submit、scheduling、same-session lane policy、latest-request handling、cancellation、terminal commit 和 canonical timeline publication。`stable ts-core-contracts` 已经冻结 `RuntimeCommandPort`、`RequestRun`、`RunStatus`、terminal commit、CAS/version、timeline/stream vocabulary 和 gateway logical port 边界。

架构评审确认后，本 change 的流程口径修正为：submit 负责受理请求并入队，scheduler 负责从队列 dispatch 执行。same-session lane policy 不应被描述为 submit 前的“是否创建 run”判断，而应被描述为 Runtime scheduler、latest-submit replacement、control command 和 recovery 使用的 queued/executing/latest/terminal-pending facts 规则。

职责边界：

- Channel 只把 Web submit/control command 交给 Runtime。
- Runtime submit 校验身份、session、输入、附件和幂等后，创建并持久化 `RequestRun`，使其进入 `QUEUED`。
- Runtime 在新 run 成功进入 queue 后执行 latest-submit replacement：older queued work 被 terminal commit 为 `SUPERSEDED`，older executing work 收到 supersession signal。
- Runtime scheduler 读取 lane facts，决定 queued work 何时可以变成 `EXECUTING`。
- Gateway 只提供 agent+owner-scoped durable facts，不返回调度决策。
- Session 只解释 terminal facts 在 history 中的意义，不决定 run 是否 queued、executing、blocked 或 superseded。
- Agent Loop 只执行 Runtime 分配的 `RequestRun`，不拥有 lane/latest 状态机。

当前 active core contract 中 `RequestRunStoreGateway` 缺少按 `tenantId + subjectId + agentId + sessionId` 读取 lane facts 的查询。只依赖进程内 scheduler queue 会让 recovery、request control 和未来 PaaS 形态缺少可持久化事实来源；让 Runtime 直接读 adapter-private SQL 又会破坏 gateway boundary。因此本 change 添加正式 agent+owner-scoped session lane snapshot 查询。

本 change 同时明确“看起来有多个队列”的分层：durable `RequestRun.status=QUEUED` 是权威排队事实；Runtime scheduler pending queue 是进程内执行调度结构，可丢失、可重建、可被 durable facts 校正；`loadSessionLaneSnapshot` 返回的是 agent+owner-scoped lane facts read model，不是第二套业务队列，也不是 queue manager。

## 目标和非目标（Goals / Non-Goals）

**目标：**

- 定义一条 session lane 的 agent+owner-scoped key：`tenantId + subjectId + agentId + sessionId`。
- 定义 submit -> queued -> scheduler dispatch -> executing -> terminal commit 的职责分层。
- 定义同一 lane 默认串行 dispatch：首版同一 lane 同时最多一个 `EXECUTING` run。
- 定义 queued run、executing run、terminal run 和 terminal-pending run 的判断规则。
- 定义 queue authority：权威排队事实来自 durable `RequestRun`，scheduler pending queue 只是可重建的运行时调度结构。
- 定义 `RequestRunStoreGateway.loadSessionLaneSnapshot` 查询契约，使 Runtime 可通过 public gateway contract 读取 lane facts。
- 保证 terminal commit pending/retrying 不被后续 same-lane queued work 打断。
- 定义 latest-submit replacement：同 lane 后续 submit 替换旧未完成请求，但不绕过 queue、scheduler dispatch 或 terminal commit/lane release。
- 保证不新增 `RunStatus`、`TimelineEventType` 或 `StreamEventType`。

**非目标：**

- 不实现公平调度、复杂队列 UI 或用户可管理队列。
- 不实现完整 cancel hardening、retry、edit-resubmit、runtime recovery 或 side-effect idempotency guard。
- 不实现 PaaS 多实例 shared runtime state、lock/lease、worker registry 或 non-sticky routing。
- 不定义本地数据库 schema、索引名称、文件路径或 adapter-private query。
- 不改变 Agent routing、Context Assembly、Model invocation 或 Tool capability 调用语义。

## 设计决策（Decisions）

### D1: Lane key 使用 `tenantId + subjectId + agentId + sessionId`

选定方案：Runtime 使用可信 `identityContext.tenantId`、`identityContext.subjectId`、可信 Agent Scope 中的 `agentId` 和 command 中的 `sessionId` 定位一条 session lane。`agentId` 必须来自可信 app composition/hosted-agent selection 或已持久化 `Session.agentId` / `RequestRun.agentId`，不得来自客户端 payload、metadata、模型输出或 capability input。

理由：NextAgent 主路径同时要求 Agent Scope 和 Owner Scope。只使用 `sessionId` 会让 lane lookup 无法表达租户、用户和 Agent 归属；只使用 owner scope 会让同一租户/用户/会话下不同 Agent 的 run 互相阻塞或泄露，违反 runtime/gateway 读取 durable fact 必须携带 agent+owner scope 的前置契约。

拒绝方案：只用 `sessionId`，或只用 `tenantId + subjectId + sessionId` 作为 lane key。拒绝原因是它弱化 agent+owner-scope guard，且不同 tenant/subject/agent 下的同名 session 无法安全隔离。

### D1A: RequestRun gateway 主路径 scope 基础由本 change 承载

选定方案：除 lane snapshot 外，本 change 同步固定 RequestRun 主路径 lookup、claim、terminal commit、acceptance idempotency anchor 和 terminal commit idempotency anchor lookup 的 agent+owner-scoped gateway contract 基础。所有读取或推进 user/session lane 内 RequestRun facts 的 gateway request 必须携带可信 `tenantId`、`subjectId`、`agentId` 和 run/session 坐标；`agentId` 只能来自可信 app composition、hosted-agent selection、已持久化 `Session.agentId` 或已持久化 `RequestRun.agentId`。

理由：cancel、retry 和 local recovery 都会读取或推进同一类 RequestRun 主路径事实。如果每个 change 各自补 owner/agent scope，会出现同形 contract 的重复 DTO、重复测试和不同冲突语义。本 change 已经是 same-session lane 与 RequestRun durable fact 的共享基础，因此承接统一 scope 原则；各 command change 只定义自己的业务状态矩阵、SafeError 和副作用边界。Retry 的重复 accepted response 从新 retry run 的 acceptance anchor 推导；cancel 的重复 accepted response 从目标 run 的 terminal commit anchor 推导；二者都不得新增独立 command outcome durable fact。

拒绝方案：让 cancel、retry、recovery 各自定义一套 scoped run lookup/claim/terminal commit request，或新增独立 `RuntimeControlCommandOutcomeRecord` / command outcome store。拒绝原因是这会让同一 agent+owner-scoped RequestRun fact 在不同 command 下出现平行 contract，破坏“同形同策”和 Gateway logical port 边界。

### D2: Submit 只表示受理并入队，不表示开始执行

选定方案：`RuntimeCommandPort.submit` 成功后，Runtime 创建 `RequestRun`，持久化 `ACCEPTED`/`QUEUED`，交给 Runtime scheduler，并返回 `RequestAccepted`。`RequestAccepted` 不承诺 Agent execution 已开始。

理由：目标实现应先创建 run、保存 `QUEUED`，再交给 Runtime scheduler enqueue/dispatch path；scheduler dispatch 才负责把 pending work 变成 active execution。TS 架构也应保持 submit 与 dispatch 的边界；latest-submit replacement 是 Runtime 在新 run 成功 queued 后执行的 lifecycle policy，不是 submit 前拒绝创建 run，也不是 scheduler 立即并发 dispatch。

拒绝方案：在 submit 流程开始处读取 lane snapshot，并用 snapshot 决定是否创建 run。拒绝原因是它绕过了队列模型，会把 latest-request handling 变成 admission-time 拒绝，而不是 Runtime-owned queued lifecycle policy。

### D3: Scheduler 负责 same-lane serial dispatch

选定方案：同一 agent+owner-scoped lane 可以有 queued runs；Runtime scheduler 在 dispatch 前确认同一 lane 当前没有正在执行且会冲突的 `EXECUTING` run，并且没有需要保护的 terminal-pending run。首版同一 lane 同时最多一个 `EXECUTING` run；不同 lane 可在全局容量限制内并发。

理由：same-session lane 的核心风险是两个 run 同时写同一 session 的 terminal/history facts，而不是两个 run 同时存在于队列。queued run 是系统受理请求后的正常中间状态。

拒绝方案：不支持多 queued 队列。拒绝原因是 Runtime scheduler 本身就是队列模型；把 queued run 排除在范围外会让 submit、status visibility、queue timeout 和 recovery 语义无法闭合。

补充边界：同一系统内可以同时存在 durable queued facts、scheduler pending queue 和 snapshot view，但三者不是三个互相竞争的真相。Runtime 必须以 durable `RequestRun` facts 为准；scheduler pending queue 只是调度器手里的待办清单；snapshot view 只是 Runtime 通过 Gateway 翻阅权威状态账本的 agent+owner-scoped 查询结果。

### D4: Active/queued/terminal 使用已冻结 `RunStatus`

选定方案：

- Queued run status：`ACCEPTED`、`QUEUED`、`PLANNING` 中尚未开始 Agent execution 的 run。
- Executing run status：`EXECUTING`。
- Terminal run status：`COMPLETED`、`FAILED`、`CANCELED`、`SUPERSEDED`。
- Terminal pending run：`terminalCommitState` 为 `PENDING` 或 `RETRYING` 的 run。

理由：`RunStatus` vocabulary 已经由 core contract 冻结。本 change 只定义状态使用规则，不新增 `WAITING_FOR_LANE`、`REPLACED` 或 `BUSY` 等新状态。

### D5: 新增 `loadSessionLaneSnapshot` 查询契约

选定方案：在 `RequestRunStoreGateway` 增加只读查询：

```ts
interface SessionLaneSnapshotQuery {
  readonly tenantId: TenantId
  readonly subjectId: SubjectId
  readonly agentId: AgentId
  readonly sessionId: SessionId
}

interface SessionLaneSnapshot {
  readonly tenantId: TenantId
  readonly subjectId: SubjectId
  readonly agentId: AgentId
  readonly sessionId: SessionId
  readonly latestRequestId?: MessageId
  readonly latestRun?: RequestRunRecord
  readonly executingRun?: RequestRunRecord
  readonly queuedRuns: readonly RequestRunRecord[]
  readonly terminalPendingRun?: RequestRunRecord
}

interface RequestRunStoreGateway {
  loadSessionLaneSnapshot(query: SessionLaneSnapshotQuery): Promise<SessionLaneSnapshot>
}
```

Gateway 必须在同一个 agent+owner-scoped read boundary 中返回这些 gateway-owned facts。Gateway 不返回 `shouldStartExecution`、`shouldQueue`、`shouldSupersede`、`shouldReject` 等决策字段，也不得直接返回 runtime DO。

该 snapshot 不是 scheduler queue。它不得分配、排序、dispatch、保留或移除 work item；不得作为运行时唯一状态来源；不得替代 `RequestRun.status`、terminal commit state 或 Runtime scheduler 的 dispatch decision。

理由：Runtime scheduler、latest-submit replacement、control command 和 recovery 需要读取 durable queued/executing/latest/terminal-pending facts。正式查询契约可以避免 Runtime 依赖 adapter-private SQL、进程内 scheduler map 或 Session/Channel 私有 latest 判断，同时避免把 Gateway 变成调度器。

拒绝方案：

- Runtime 只使用进程内 scheduler queue：重启后丢失 lane facts，不能支撑恢复边界。
- Runtime 直接查询本地数据库：泄漏 adapter-private schema 到 Runtime。
- SessionStore 返回 queued/executing/latest：让 Session 抢占 runtime lifecycle ownership。

### D6: Dispatch 决策流

选定方案：scheduler dispatch 的流程固定为：

1. Runtime scheduler 准备从 queue 中启动某个 `QUEUED` run。
2. Runtime 使用可信 identity、trusted Agent Scope 和 `sessionId` 调用 `loadSessionLaneSnapshot`。
3. Runtime 先确认待 dispatch 的 work item 仍然对应 durable `QUEUED` run；如果 durable state 已经 terminal、owner mismatch 或不存在，scheduler 丢弃该内存 work item 并走 safe diagnostic path。
4. 如果 snapshot 存在 `terminalPendingRun`，该 same-lane queued run 保持 `QUEUED`，不得开始会写 terminal/history 的执行。
5. 如果 snapshot 存在其他 `executingRun`，该 same-lane queued run 保持 `QUEUED`，直到 lane 的 executing run 完成、取消、失败或完成 terminal commit。
6. 如果 lane 没有 blocking executing/terminal-pending run，Runtime 将该 run 从 `QUEUED` 推进为 `EXECUTING` 并调用 Agent execution。
7. 不同 lane 的 queued runs 不通过同一 session lane 串行化，但仍受全局容量和运行时 backpressure 限制。

理由：该流程保留 submit 的快速受理体验，同时把同会话串行执行控制放在真正开始执行之前，符合队列和调度器模型。

### D7: Same-lane 后续 submit 触发 latest-submit replacement

选定方案：同一 agent+owner-scoped lane 的后续普通 submit 成功 queued 后，Runtime 将它作为 latest executable request。Runtime 必须对同 lane older non-terminal work 执行 replacement policy：

- older queued run：通过 terminal commit 写入 `RunStatus.SUPERSEDED` 和 canonical `REQUEST_SUPERSEDED` terminal event，并从 scheduler pending queue 中取消、丢弃或校正对应 work item。
- older executing run：通过 Runtime-owned execution handle 发出 supersession signal，记录 replacement request identity，使旧 run 跑到当前 Agent loop 安全边界后停止继续推进；如果旧 run 尚未形成完整 terminal assistant message，应以 `SUPERSEDED` terminalize；如果 supersession 到达时旧 run 已经形成完整可提交 terminal result，可以按 completed-but-overtaken 结果提交并保留 replacement metadata。
- newer run：保持 `QUEUED`，直到 older executing/terminal-pending run 完成 terminal commit 并释放 lane 后，才允许 scheduler dispatch 为 `EXECUTING`。

理由：baseline 要求 Runtime 同时拥有 request submit、same-session lane、latest-request handling、scheduling 和 terminal commit。新 run 先 queued/scheduled，再由 Runtime 对 older same-session work 发出 supersession 或 terminalize queued old work；这说明 latest-submit replacement 与 scheduler queue 并不冲突。冲突的是让 replacement 绕过 terminal commit 或让 Channel/Session 代替 Runtime 决定 latest。

拒绝方案：newer submit 只排队等待 older run 完整执行，不触发 latest replacement。拒绝原因是它会让过时请求继续成为可执行事实，削弱 latest-request handling，并与 same-session preemption 语义不一致。

拒绝方案：newer submit 一到达就立即并发执行。拒绝原因是它绕过 same-lane serial dispatch 和 terminal commit ordering，会让两个 run 同时写同一 session history、checkpoint 或 timeline。

### D8: Terminal commit pending/retrying 阻塞 dispatch，不阻塞入队

选定方案：当同一 lane 存在 `terminalCommitState=PENDING|RETRYING` 的 run 时，新 submit 可以创建 `QUEUED` run 并成为 latest request，但 Runtime 不对已经 terminal-pending 的旧 run 发起第二个 terminal replacement commit；scheduler 不得启动该 queued run 的 terminal-writing execution，直到旧 terminal commit 收敛。

理由：terminal commit 是 terminal stream event 和 visible history 可见的前置条件。阻塞 dispatch 而不是阻塞 submit，既保护终态一致性，也保留用户请求已受理的反馈。

### D9: Timeline 不新增 queued event

选定方案：`QUEUED` 只通过 `RunStatus` 表达；本 change 不新增 `REQUEST_QUEUED`。如果 latest-submit replacement supersede 旧 run，则使用已有 terminal event `REQUEST_SUPERSEDED`。

理由：`TimelineEventType` 已冻结，新增 event vocabulary 会扩大 core contract refinement 范围。本 change 只需要明确 queue/run facts 和 terminal consistency。

### D10: Idempotency 不进入 lane snapshot

选定方案：`SessionLaneSnapshot` 不包含 idempotency lookup 字段。Submit/retry 的重复 `idempotencyKey` 处理由 `RequestRunStoreGateway.saveRun` 的 idempotent write 语义、`RequestRunStoreGateway.loadRunByIdempotencyKey(anchor=ACCEPTANCE)` 和 Runtime command handling 承载；cancel 的重复 `idempotencyKey` 处理由目标 run 的 terminal commit metadata、`RequestRunStoreGateway.loadRunByIdempotencyKey(anchor=TERMINAL_COMMIT)` 和 Runtime command handling 承载；Runtime command boundary 必须收到非空 canonical `idempotencyKey` 后才能进入 run creation、scheduler、terminal commit 或 timeline side effect。相同 command semantic 与相同 `idempotencyKey` 不创建重复 run 或第二次 terminal commit，相同 key 与不同 command semantic 返回 safe conflict。

Runtime 的 submit idempotency fingerprint 至少覆盖可信 agent+owner scope、`sessionId`、submit action、规范化后的用户输入语义、附件 ref 集合和 `idempotencyKey`。Retry/cancel command semantic 至少覆盖可信 agent+owner scope、`sessionId`、canonical action、`expectedLatestRequestId` 和 `idempotencyKey`。Runtime 不规定 public Web DTO 的 key 来源：前端传入后由 Channel 校验、或 Channel 自行生成，都属于 Channel/Web boundary 的选择；本 change 只要求调用 Runtime 前已经形成 canonical key，且 Runtime 不从 client metadata、模型输出或 capability input 中回填 key。

理由：lane snapshot 只表达 session lane facts。将 idempotency lookup 塞进 snapshot 会混合两个不同问题，增加查询复杂度。将 control command response 持久化为独立 outcome store 又会制造与 `RequestRun` 和 terminal commit 并行的事实源；读取已有 RequestRun idempotency anchor 才符合 gateway 主路径事实源约束。

### D11: SafeError reason code

选定方案：Runtime 至少支持以下 safe reason code：

- `STALE_LATEST_REQUEST`
- `LANE_TERMINAL_COMMIT_PENDING`
- `LANE_EXECUTION_BLOCKED`
- `SCHEDULER_QUEUE_CAPACITY_EXHAUSTED`
- `SUBMIT_IDEMPOTENCY_REQUIRED`
- `DUPLICATE_IDEMPOTENCY_KEY_CONFLICT`
- `RUN_NOT_REPLACEABLE`

Owner scope mismatch 对外不得泄露目标资源存在性，按安全错误边界归一化为 safe not-found/forbidden 类响应。

## 质量属性设计（Quality Attributes）

| 质量属性 | 设计结论 | 验证入口 |
|---|---|---|
| 安全 | Lane query 必须显式携带 `tenantId`、`subjectId`、`agentId` 和 `sessionId`；请求体、客户端 metadata、模型输出和 capability args 不能覆盖 command identity 或 Agent Scope；agent/owner mismatch 不暴露目标是否存在。 | agent+owner-scope contract tests；gateway agent+owner-scope tests；SafeError tests。 |
| 性能/容量 | Submit 快速入队；scheduler 在 dispatch 前读取 agent+owner-scoped lane snapshot；首版可使用 bounded queue depth 和 global concurrency，不引入公平调度或复杂 UI 队列。 | Runtime scheduler tests；basic load smoke test；queue capacity/depth tests。 |
| 可靠性/恢复 | Terminal pending/retrying 阻塞 same-lane dispatch；queued run 可通过 durable facts 恢复；scheduler pending queue 丢失时以 durable `RequestRun` facts 重建或校正；同一 run terminal commit 继续使用 CAS/version。 | Runtime characterization tests；terminal commit idempotency tests；scheduler rebuild tests；recovery-oriented gateway tests。 |
| 可维护性 | Runtime 做唯一 lifecycle/scheduler 决策；Gateway 只返回 durable facts；Channel/Session/Agent 不复制 lifecycle state machine。 | architecture boundary tests；module dependency checks；code review of ownership boundaries。 |
| 可测试性 | `loadSessionLaneSnapshot` 提供 deterministic test seam；session lane scenarios 可以用 fake gateway 构造 queued/executing/latest/terminal-pending facts。 | contract tests；runtime unit tests with fake gateway；integration tests using local gateway。 |
| 审计/可追溯 | Queued、executing、terminal facts 归属于对应 run；latest-submit replacement 使用 `SUPERSEDED` 或 completed-with-replacement metadata，用户 cancel 使用 `CANCELED`。 | audit/log assertions；timeline event tests；metrics label checks。 |

## 文档承载决策（Documentation Ownership）

- 行为契约：`openspec/specs/session-lane-scheduling/spec.md` 主承载 same-session queued scheduling、latest-submit replacement、serial dispatch 和 terminal-pending protection；`openspec/specs/ts-core-contracts/spec.md` 主承载 gateway query refinement。
- 跨模块架构：`openspec/designs/architecture/runtime-boundaries.md` 主承载 Runtime、Channel、Session、Gateway、Agent 在 submit/queue/dispatch/terminal flow 中的职责边界。
- 领域模型/状态机：`openspec/designs/architecture/request-run.md` 主承载 queued run、executing run、terminal pending、replacement/supersession 和 terminal commit 不变量。
- API/SPI/event/schema：`openspec/designs/architecture/core-contracts.md` 主承载 `SessionLaneSnapshotQuery`、`SessionLaneSnapshot`、`RequestRunStoreGateway.loadSessionLaneSnapshot`、`RequestRunStoreGateway.loadRunByIdempotencyKey`、RequestRun 主路径 scoped lookup/claim/terminal commit、acceptance idempotency anchor 和 terminal commit idempotency anchor lookup 语义。
- 模块职责：`openspec/designs/modules/agent-runtime.md` 和 `openspec/designs/modules/agent-platform-gateway-local.md` 分别主承载 Runtime scheduler 职责和 local gateway fact query 职责。
- ADR：`openspec/designs/adr/session-lane-snapshot-query.md` 记录选择正式 agent+owner-scoped snapshot 查询的取舍。
- 导航：`openspec/designs/spec-to-design-map.md` 记录 `session-lane-scheduling` 的 spec 到 design/test 入口。

## 风险与取舍（Risks / Trade-offs）

- [风险] `loadSessionLaneSnapshot` 发现同一 lane 存在多个异常 `EXECUTING` runs。-> Gateway 不私自选择胜者，必须返回 facts 或契约级一致性错误；Runtime 按 conflict safe error 进入诊断路径，后续 recovery change 负责修复策略。
- [风险] Terminal pending run 导致后续请求短暂 queued。-> 本 change 接受该等待以保护 terminal correctness；Channel 可通过 `RunStatus=QUEUED` 投影等待状态。
- [风险] 不新增 `REQUEST_QUEUED` 降低 stream 细粒度。-> 本 change 以 `RunStatus=QUEUED` 作为可见状态，避免扩大 event vocabulary。
- [风险] latest-submit replacement 被误解为绕过 scheduler。-> 契约明确 newer run 仍先进入 `QUEUED`，older run 必须到安全边界并完成 terminal commit/lane release 后，scheduler 才能 dispatch newer run。
- [风险] Snapshot query 被误解为第二套队列。-> 契约明确 snapshot 是只读 facts read model；权威状态来自 durable `RequestRun`；scheduler pending queue 只是可重建的执行调度结构。
- [风险] Snapshot query 增加 core contract surface。-> 该 surface 是只读 facts query，范围小，并明确 Gateway 不拥有调度状态机。

## 归档前基线提升计划（Baseline Promotion Plan）

- `openspec/specs/session-lane-scheduling/spec.md`：提升同会话 queued scheduling、latest-submit replacement、serial dispatch、terminal-pending protection、不同 session 并发和 SafeError 契约。
- `openspec/specs/ts-core-contracts/spec.md`：提升 `RequestRunStoreGateway.loadSessionLaneSnapshot`、`RequestRunStoreGateway.loadRunByIdempotencyKey` 查询契约，以及 RequestRun 主路径 lookup、claim、terminal commit、acceptance idempotency anchor 和 terminal commit idempotency anchor lookup 的 agent+owner-scoped contract 基础。
- `openspec/overview.md`：提升同会话连续请求对电信网络智能体操作体验和可靠性的背景。
- `openspec/designs/architecture/runtime-boundaries.md`：提升 Runtime queue/dispatch flow 和跨模块职责边界。
- `openspec/designs/architecture/request-run.md`：提升 RequestRun queued/executing/terminal-pending/replacement 不变量。
- `openspec/designs/architecture/core-contracts.md`：提升 session lane snapshot query schema、RequestRun idempotency anchor lookup schema 和 RequestRun 主路径 scope/idempotency anchor 语义。
- `openspec/designs/modules/agent-runtime.md`：提升 Runtime 消费 snapshot 和执行 scheduler dispatch decision 的职责。
- `openspec/designs/modules/agent-platform-gateway-local.md`：提升 local gateway 只返回 facts 的职责。
- `openspec/designs/adr/session-lane-snapshot-query.md`：提升正式查询契约取舍。
- `openspec/designs/spec-to-design-map.md`：提升导航和验证入口。

## 待确认问题（Open Questions）

- 无。latest-submit replacement 已纳入本 change 范围；后续 retry/edit-resubmit 只需要复用或细化自己的目标选择规则。
