# add-ts-session-lane-scheduling

规划入口：[roadmap-v2](../nextagent-ts-change-roadmap-v2.md)
所属分组：请求控制

状态：active
类型：实施 change
主要 owner：`agent-runtime`
协作 owner：`agent-session`
依赖：`ship-ts-minimal-agent-kernel`

目标：
- 支持同会话默认入队、latest-submit replacement、串行调度执行和 terminal-pending 保护，同时保持 runtime command ownership 不变。

能力组共享输入：

整理状态：已整理为能力组级输入

能力组目标：
- 补实当前会话内请求控制能力，同时保持 runtime command ownership 不变。

共享规格输入：
- 当前会话内可操作请求的判定、非法操作结果和安全可见性，是请求控制能力组的共享语义，不单独作为实施 change。
- 取消、重试和编辑重提各自必须说明适用请求状态、目标选择规则和非法操作结果。

并行边界：
- 这些 change 只能扩展 runtime command、scheduler 和合法性规则，不得改写最小内核的 request lifecycle owner。

后续维护：
- 本文件承载该 change 的详细规格输入、契约输入、实现约束、非目标、验收要点和并行边界。
- 如果本 change 需要修改已冻结核心契约，必须先提出 contract refinement change。

正式 OpenSpec change：
- `openspec/changes/add-ts-session-lane-scheduling/`

已确认范围：
- Lane key 固定为 `tenantId + subjectId + sessionId`，不能只使用 `sessionId`。
- 普通 submit 成功后创建 `RequestRun`，持久化为 `ACCEPTED`/`QUEUED`，并交给 Runtime scheduler；`RequestAccepted` 表示已受理并入队，不表示 Agent execution 已开始。
- 同一 lane 可以存在 queued runs；同一 lane 默认串行 dispatch，首版同一 lane 同时最多一个 `EXECUTING` run。
- 权威排队事实是 durable `RequestRun.status=QUEUED`；Runtime scheduler 的 pending queue 只是执行调度结构，可丢失、可重建，不是第二套业务真相。
- terminal 状态沿用已冻结 `COMPLETED`、`FAILED`、`CANCELED`、`SUPERSEDED`，本 change 不新增 `RunStatus`。
- 旧 run 处于 `terminalCommitState=PENDING|RETRYING` 时，新 submit 可以进入 `QUEUED`，但 scheduler 不得在旧 terminal commit 收敛前启动会写 terminal/history 的后续执行。
- 同一 owner-scoped lane 的后续普通 submit 使用 latest-submit replacement policy：新 run 先 accepted/queued，Runtime 将 older queued work terminal commit 为 `SUPERSEDED`，并向 older executing work 发出 supersession signal。
- latest-submit replacement 不绕过 scheduler：新 run 必须等旧 run 到达安全边界并完成 terminal commit/lane release 后，才允许被 dispatch 为 `EXECUTING`。
- 用户主动 cancel 使用 `CANCELED`；latest-submit replacement、edit-resubmit 或其他明确替换语义替换旧 run 时使用 `SUPERSEDED`。
- `QUEUED` 只通过 `RunStatus` 表达，不新增 `TimelineEventType` 或 `StreamEventType`。

契约输入：
- 在 `RequestRunStoreGateway` 增加 `loadSessionLaneSnapshot(query)`，由 Runtime scheduler、request control 和 recovery 读取 owner-scoped lane facts。
- `SessionLaneSnapshotQuery` 必须携带 `tenantId`、`subjectId`、`sessionId`。
- `SessionLaneSnapshot` 返回 `latestRequestId`、`latestRun`、`executingRun`、`queuedRuns`、`terminalPendingRun` 等 durable facts。
- `loadSessionLaneSnapshot` 是 lane facts read model，不是 scheduler queue；它不得分配、排序、dispatch、保留或移除 work item。
- Gateway 只返回 facts，不返回 `shouldQueue`、`shouldSupersede`、`shouldReject`、`shouldStartExecution` 等调度决策；start、queue、supersede、reject 仍由 Runtime 决定。
- Idempotency 不放进 lane snapshot；重复 submit 由 `saveRun` 的幂等写语义和 Runtime command handling 承载。

非目标：
- 不实现完整 cancel hardening、retry、edit-resubmit、runtime recovery 或 side-effect idempotency guard。
- 不实现公平调度、全局容量策略、复杂队列 UI、PaaS 多实例 lock/lease/shared state 或数据库 schema 细节。
- 不让 latest-submit replacement 绕过 scheduler、terminal commit、owner scope 或 Runtime lifecycle ownership。
- 不改变 Channel、Session、Agent Loop、Context Assembly、Model invocation 或 Tool capability 的职责边界。

验收要点：
- Contract tests 覆盖 owner scope、latest/queued/executing/terminal-pending facts 和空 lane。
- Runtime scheduler characterization tests 覆盖 submit creates queued run、same-lane serial dispatch、different-lane concurrency、terminal pending blocks dispatch、queue capacity/depth safe outcome。
- Runtime recovery/scheduler tests 覆盖 scheduler pending queue 丢失或重建时，Runtime 仍以 durable `RequestRun` facts 和 `loadSessionLaneSnapshot` 结果为准。
- Latest-submit replacement tests 覆盖 newer submit accepted/queued 后，older queued work 被 terminal commit 为 `SUPERSEDED`，older executing work 收到 supersession signal，且 newer run 不在旧 run terminal commit 前开始执行。
- Stream/history tests 覆盖 queued status 可见、terminal fact 有且只有一个、superseded run 已发布 timeline facts 保留。
- Gateway owner-scope tests 覆盖不同 tenant、subject、session 互不泄露或互相阻塞。
- `openspec validate add-ts-session-lane-scheduling --strict` 必须通过。
