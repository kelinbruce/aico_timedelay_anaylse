## 1. 契约与测试基线

- [x] 1.1 在核心 gateway 契约中新增 `SessionLaneSnapshotQuery` 和 `SessionLaneSnapshot`，字段固定为 `tenantId`、`subjectId`、`agentId`、`sessionId`、`latestRequestId`、`latestRun`、`executingRun`、`queuedRuns`、`terminalPendingRun`。
- [x] 1.2 在 `RequestRunStoreGateway` 新增只读方法 `loadSessionLaneSnapshot(query)`，并保持 gateway 只返回 gateway-owned durable facts/read model，不返回 runtime DO、`shouldQueue`、`shouldSupersede`、`shouldReject` 或 `shouldStartExecution` 等调度决策。
- [x] 1.3 明确 snapshot 是 agent+owner-scoped lane facts read model，不是 scheduler queue；契约和测试必须证明 snapshot 不分配、排序、dispatch、保留或移除 work item。
- [x] 1.4 为 snapshot 契约增加 contract tests，覆盖 agent scope、owner scope 过滤、latest run 选择、queued run 列表、executing run 分类、terminal pending/retrying run 返回，以及无匹配 run 时的空 lane snapshot。
- [x] 1.5 为 submit 幂等语义增加 characterization tests，固定缺失/空 `idempotencyKey` 在 Runtime command boundary 返回 safe validation、相同 `idempotencyKey` 与相同 command semantic 不创建重复 run、相同 key 不同 command semantic 返回 safe conflict 的行为。
- [x] 1.6 对照 `stable ts-core-contracts` 确认 `SessionLaneSnapshotQuery`、`SessionLaneSnapshot` 和 `RequestRunStoreGateway.loadSessionLaneSnapshot` 属于 core/gateway 契约细化，只暴露 agent+owner-scoped gateway-owned durable facts，不引入 runtime DO 或 scheduler decision DTO；对照 `stable ts-backend-architecture` 确认 Runtime 仍拥有 lane/scheduler 决策，local gateway 只提供持久化事实。
- [x] 1.7 补齐 RequestRun 主路径 gateway scope contract tests，覆盖 lookup、claim、terminal commit 和 scoped empty/not-found 分支必须同时使用可信 `tenantId`、`subjectId`、`agentId` 与 run/session 坐标。
- [x] 1.8 补齐 RequestRun idempotency anchor tests，覆盖同 agent+owner+session+semantic+key 重放返回原 accepted run，`anchor=ACCEPTANCE` 可恢复 retry 的原 `RequestAccepted`，`anchor=TERMINAL_COMMIT` 可恢复 cancel 的原或等价 `RequestControlAccepted`，同 key 不同 semantic 返回 safe conflict，且不同 agent/owner/anchor 下同 key 不互相污染。
- [x] 1.9 做 cross-change contract boundary 检查，确认 `add-ts-request-cancel`、`add-ts-request-retry` 和 `add-ts-local-runtime-recovery` 复用本 change 的 RequestRun scope、acceptance idempotency anchor 和 terminal commit idempotency anchor lookup 基础，不各自新增平行 scoped lookup/claim/terminal commit DTO，也不新增独立 command outcome store。

## 2. Local Gateway Snapshot

- [x] 2.1 在 local gateway adapter 实现 `loadSessionLaneSnapshot(query)`，查询条件必须同时包含 `tenantId`、`subjectId`、`agentId` 和 `sessionId`。
- [x] 2.2 保证 local gateway 在同一 agent+owner-scoped read boundary 内返回 latest、queued、executing 和 terminal pending facts，且不在 adapter 内编码 lane admission 或 scheduler dispatch 决策。
- [x] 2.3 增加 local gateway tests，覆盖不同 tenant、不同 subject、不同 agent、不同 session 之间互不泄露或互相阻塞。
- [x] 2.4 增加异常数据测试：同一 lane 出现多个异常 executing runs 时，gateway 返回 facts 或契约级一致性错误，Runtime 转换为 safe error，不由 gateway 私自选择胜者。
- [x] 2.5 在 local gateway adapter 中对 RequestRun lookup、claim、terminal commit、acceptance idempotency anchor 和 terminal commit idempotency anchor lookup 使用同一 agent+owner-scoped过滤原则，并验证 scope mismatch 不返回跨 agent/owner facts。

## 3. Runtime Queue And Scheduler Dispatch

- [x] 3.1 在 `RuntimeCommandPort.submit` 中保持 submit -> accepted/queued -> scheduler schedule 的流程，确保 `RequestAccepted` 表示请求已受理并入队，不表示 Agent execution 已开始。
- [x] 3.2 实现 submit 入队行为：通过 Runtime 创建新 `RequestRun`，持久化 `ACCEPTED`/`QUEUED`，并交给 Runtime scheduler。
- [x] 3.3 将 durable `RequestRun.status=QUEUED` 固定为权威 queue state；scheduler pending queue 只能作为可重建的 dispatch aid，不能成为 lifecycle truth。
- [x] 3.4 在 Runtime scheduler dispatch、request control 和 recovery 判断中读取 agent+owner-scoped session lane snapshot，并只使用可信 identity context 中的 `tenantId`、`subjectId` 和可信 app composition、hosted-agent selection 或已持久化 `Session.agentId` / `RequestRun.agentId` 决定的 `agentId`。
- [x] 3.5 实现 same-lane serial dispatch：同一 lane 存在 blocking `EXECUTING` run 时，后续 same-lane queued run 保持 `QUEUED`，不得开始会写 terminal/history 的执行。
- [x] 3.6 实现 terminal pending/retrying 保护：旧 run `terminalCommitState=PENDING|RETRYING` 时，新 submit 可以进入 `QUEUED`，但 scheduler 不得在旧 terminal commit 收敛前执行 terminal-writing work。
- [x] 3.7 实现 latest-submit replacement：同一 agent+owner-scoped lane 的 newer submit 成功 queued/scheduled 后，older queued work 必须 terminal commit 为 `SUPERSEDED` 并清理 scheduler pending work item；older executing work 必须收到 supersession signal，且 newer run 在旧 run 到达安全边界并完成 terminal commit/lane release 前保持 `QUEUED`。
- [x] 3.8 实现 safe error reason code 分支，至少覆盖 `STALE_LATEST_REQUEST`、`LANE_TERMINAL_COMMIT_PENDING`、`LANE_EXECUTION_BLOCKED`、`SCHEDULER_QUEUE_CAPACITY_EXHAUSTED`、`SUBMIT_IDEMPOTENCY_REQUIRED`、`DUPLICATE_IDEMPOTENCY_KEY_CONFLICT` 和 `RUN_NOT_REPLACEABLE`。
- [x] 3.9 在 Runtime submit 和 request-control 前置读取中只消费本 change 定义的可信 Agent Scope / Owner Scope，不从 command payload、client metadata、模型输出或 capability input 回填 `agentId`、owner scope 或 idempotency semantic。

## 4. Stream、History 与边界保护

- [x] 4.1 保持 `CANCELED` 只表示用户主动 cancel；latest-submit replacement、edit-resubmit 或其他明确替换语义替换旧 run 时使用 `SUPERSEDED`。
- [x] 4.2 保持已发布的 run timeline facts，不删除或改写 supersession 前已经进入 canonical timeline 的中间事实。
- [x] 4.3 保持 `QUEUED` 只通过 `RunStatus` 表达，不新增 `TimelineEventType`、`StreamEventType` 或 `RunStatus`。
- [x] 4.4 确认 `agent-channel-web` 只调用 Runtime command boundary，不实现 lane/latest/scheduler/supersede 判断。
- [x] 4.5 确认 `agent-session` 只消费 Runtime terminal facts 并解释 history，不判断 run 是否 queued、executing、blocked 或 superseded。

## 5. Characterization 与集成验证

- [x] 5.1 增加 Runtime scheduler characterization tests：submit creates queued run、same-lane serial dispatch、different-lane concurrency、terminal pending blocks dispatch、queue capacity/depth safe outcome。
- [x] 5.2 增加 scheduler queue rebuild/correction tests：当进程内 pending queue 丢失、重复或包含已 terminal run 时，Runtime 以 durable RequestRun facts 为准恢复、校正或丢弃内存 work item。
- [x] 5.3 增加 latest-submit replacement tests：newer submit accepted/queued 后，older queued work 被 terminal commit 为 `SUPERSEDED`，older executing work 收到 supersession signal，newer run 不在旧 run terminal commit/lane release 前开始执行。
- [x] 5.4 增加 stream/history consistency tests：queued status 可见、terminal fact 有且只有一个、superseded run 已发布中间 facts 保留。
- [x] 5.5 增加 agent+owner-scope security tests：agent scope 或 owner scope mismatch 不泄露目标资源是否存在，返回 safe not-found/forbidden 类响应。
- [x] 5.6 运行相关后端单元、contract、integration tests，并记录无法运行的环境性阻塞。
- [x] 5.7 运行 `openspec validate add-ts-session-lane-scheduling --strict`。

## 归档前基线提升检查

归档前由 OpenSpec archive 流程执行长期基线提升，不作为本 change 的实施任务。需要将行为契约提升到 `openspec/specs/session-lane-scheduling/spec.md` 和 `openspec/specs/ts-core-contracts/spec.md`，将长期设计提炼到 `openspec/overview.md`、`openspec/designs/architecture/runtime-boundaries.md`、`openspec/designs/architecture/request-run.md`、`openspec/designs/architecture/core-contracts.md`、`openspec/designs/modules/agent-runtime.md`、`openspec/designs/modules/agent-platform-gateway-local.md`、`openspec/designs/adr/session-lane-snapshot-query.md` 和 `openspec/designs/spec-to-design-map.md`。
## 6. Supplemental Refresh And Model Completion Fixes

- [x] 6.1 Extend session list run-summary contracts and projections so `GET /api/v1/sessions` exposes latest durable run status and in-flight state from owner+agent-scoped run facts, without letting Channel own lane lifecycle decisions.
  Validation: run backend session list projection tests and frontend route-state/session contract tests.
- [x] 6.2 Harden OpenAI-compatible stream completion so missing terminal provider completion, provider length finish, or guarded incomplete Markdown final content cannot be terminal committed as `REQUEST_COMPLETED`.
  Validation: run model provider stream tests and runtime output guard tests.
- [x] 6.3 Run targeted frontend/backend tests and `openspec validate add-ts-session-lane-scheduling --strict`.
