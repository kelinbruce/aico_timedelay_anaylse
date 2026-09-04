# Runtime 恢复

## 目的

runtime recovery 定义 Agent-bound NextAgent 应用在本地进程启动时的 request run 恢复边界。它让 runtime 只发现当前应用可信 Agent Scope 下的未完成 run，按 durable facts 分类并通过 scoped claim 防止同 Agent 短暂多副本重复恢复，同时避免重复执行 non-idempotent capability。

## 范围

当前基线承诺 startup-only bounded recovery：不同 Agent 应用可以共享 persistence backend；同 Agent 在滚动发布、故障切换或短暂双副本期间通过 RequestRun version CAS 和 lease 竞争恢复所有权。它不声明后台持续轮询、leader election、worker registry、distributed consensus、动态 lease heartbeat 或分布式 exactly-once；超过默认 lease TTL 的长时间执行续租属于后续能力。

## 启动门

`agent-app` 从可信 hosted-agent selection 向 runtime 注入不可变 `recoveryAgentId` 和进程生命周期内稳定、实例间不同的安全 holder id。`recoverLocalRuntime()` 缺少 `recoveryAgentId` 时必须 fail closed，不得回退到 default route Agent，也不得接受 Web/channel/client 提供的 Agent。runtime bootstrap 必须先完成 Agent-scoped bounded recovery scan/claim，再开放正常 scheduler dispatch。

Gateway discovery 使用 `AgentListRecoverableRunsRequest { agentId, now, limit }`。该查询不包含 Owner Scope，因为一个 Agent 应用负责该 Agent 下所有 tenant/subject 的恢复发现；每个返回的 `RequestRunRecord` 仍携带完整 owner coordinates，后续 claim、message、checkpoint、timeline 和 terminal 操作必须继续使用 record 的 Agent Scope 与 Owner Scope。

## 恢复分类

`RequestContext.agentTurnIndex` 与 checkpoint 的 `agentTurnIndex` 必须相等，并与 accepted assembly 的 `maxTurns` 一起恢复同一 logical Agent turn。恢复只接受 `0..maxTurns` 的安全整数；normal/finalizing 由 index 推导，不持久化平行 phase。pause、pending-input resume 和 crash recovery 不增加或重置 turn；checkpoint idempotency key 包含该 index，从而避免恢复后重复 normal turn 或第二次 finalizing。

- accepted/queued/planning run：先按 candidate record 的 tenant、subject、agent、run 和 expected version 执行 lease claim；只有 `UPDATED` 才使用 claim 返回的最新 record 重建 scheduler work。
- executing run：使用同一 scoped claim helper 取得 lease 后，按 checkpoint、messages、timeline 和 assembly facts重新进入可恢复执行阶段。
- terminal-pending run：必须完成 terminal commit 或写入 recovery failed terminal fact，不得停留在不可观察中间态。
- 已 terminal run：不得重复 terminal commit，不得重新派发。

`VERSION_CONFLICT`、`NOT_FOUND` 或不完整 claim result 统一跳过，不 enqueue、不执行，也不把可能已被其他实例接管的 run 标记失败。有效 lease 的 run 不进入 discovery；`lockExpiresAt <= now` 后，同 Agent 实例可以重新竞争。Terminal `PENDING/RETRYING` 继续只走既有 terminal idempotency/CAS reconciliation，不为 terminal path引入第二套 lease protocol，也不重新调用 Agent、Model 或 Capability。

## Capability 重放保护

runtime 遇到 pending capability invocation 时必须读取 capability descriptor replay policy 和 durable invocation anchor。non-idempotent invocation 不得在重启后重复执行；只能复用 durable result、标记 recovery failed，或按 spec 定义的 safe replay 策略处理。

## 调度器关系

recovery 完成后，scheduler 才能派发同 session lane 的 queued run。queued-like recovery 必须经 claim 后通过 scheduler path 重建，不得在 scan loop inline execute。lane gate 使用持久化 session/run facts，不使用进程内缓存作为唯一 truth。同 Agent 多实例共享 gateway 时，只有一个实例可以成功 claim、enqueue 和 execute 同一 run。

## 失败关闭

无法证明安全恢复的 run 必须提交 recovery failed terminal。该终态要进入 canonical timeline 和 conversation visibility 规则，不能只写日志。

## 验证关注点

- startup recovery gate、queued/executing/terminal-pending 分类有 characterization tests。
- gateway contract tests 覆盖同 Agent 跨 owner 聚合、跨 Agent 隔离、有效/过期 lease、稳定排序和 limit。
- shared-gateway 双实例 characterization test 证明 queued-like work 只有一次 claim、enqueue、execution 和 terminal fact。
- recovery failed terminal 可在 stream/history 中观察。
- pending non-idempotent capability 不重复执行。
- 已 terminal run 不重复 terminal commit。
- 恢复后的 `agentTurnIndex` 不重置，且每个 run 最多执行 `maxTurns` 个 normal turns 和一个 finalizing turn。

## Capability 失败处置协作

恢复重建使用 persisted messages、checkpoint sequence/trigger/version、lifecycle stage、tool-call state、active context version 和同一个 `agentTurnIndex`；它不保存 Capability retry attempt，也不推断是否可以重放非幂等调用。logical turn、finalizing、replay policy 与 checkpoint 幂等坐标的完整关系见 `openspec/designs/architecture/capability-invocation-and-failure-disposition.md`。
