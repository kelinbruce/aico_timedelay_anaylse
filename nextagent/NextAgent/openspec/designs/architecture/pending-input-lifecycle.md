# Pending Input 生命周期

## 目的与范围

Pending Input 生命周期定义确认、授权、问题和人工接管如何在同一个 RequestRun 内暂停、回答、取消、超时和恢复。`agent-runtime` 是 lifecycle、deadline decision、状态推进、canonical event 和 terminal commit 的唯一 owner；gateway 只提供 durable facts 与 CAS，channel 和 frontend 只提供安全输入与投影。

本设计覆盖已接受 `timeoutAt` 的持续推进、半完成 timeout 恢复、Agent/Owner scope、关闭和 session 删除边界。它不定义新的 timeout policy：缺省 deadline 固定为创建后 30 分钟，显式 deadline 必须晚于创建时刻且不超过创建后 24 小时。

## Owner 与非 Owner

- `agent-runtime` 计算并接受 `timeoutAt`，维护单 runtime deadline scheduler，执行 timeout CAS、`USER_INPUT_TIMEOUT` publication 和 `FAILED/PENDING_INPUT_TIMEOUT` terminal commit，并拒绝 late answer。
- `agent-contracts/gateway` 定义 Agent-scoped unresolved timeout fact query；`agent-platform-gateway-local` 实现专用 indexed SQL、row mapping、CAS 和 session composite delete。
- `agent-app` 注入可信 `recoveryAgentId`，在 readiness 前执行 recovery，随后启动 timeout processing，并在 gateway close 前关闭 runtime。
- `agent-session` 只从已提交 pending/run facts派生会话活动；`agent-channel-web` 和 `agent-web` 只投影 timeout 与恢复 Composer。
- Agent Core、model、Capability、client metadata、request body、gateway Record 和 frontend countdown 都不得定义或覆盖 timeout policy，也不得自行推进 lifecycle。

## Durable Facts 与查询契约

`PendingInputRecord` 是 timeout 的 durable anchor。未完成 timeout fact 是同一可信 Agent Scope 内满足以下任一条件、且已接受 `timeoutAt` 的记录：

- `PENDING`，无论 deadline 位于未来还是已经到期；
- `TIMED_OUT`，但 owning RequestRun 尚未完成 terminal commit。

Runtime 只使用：

```ts
interface PendingInputTimeoutFactCursor {
  readonly timeoutAt: EpochMillis
  readonly pendingInputId: PendingInputId
}

interface AgentListUnresolvedPendingInputTimeoutFactsRequest {
  readonly agentId: AgentId
  readonly limit: number
  readonly after?: PendingInputTimeoutFactCursor
}

interface PendingInputStoreGateway {
  listUnresolvedPendingInputTimeoutFacts(
    request: AgentListUnresolvedPendingInputTimeoutFactsRequest
  ): Promise<readonly PendingInputRecord[]>
}
```

查询不接收 `now`，不判断 due，不执行状态转换。`limit` 必须为 `1..1000`；cursor 只服务当次 processing pass，不持久化、不跨 pass 复用，也不是 feed revision。结果按 `(timeoutAt, pendingInputId)` 稳定升序，保留每条 fact 自带的 Owner + Agent + Session + Run coordinates。旧 `listDuePendingInputs(...)` 和 `ListDuePendingInputsRecordRequest` 不存在兼容 alias。

Local gateway 使用 `idx_pending_inputs_timeout_facts(agent_id, timeout_at, pending_input_id, status) WHERE timeout_at IS NOT NULL`，并以 `NOT EXISTS` 排除已 terminal committed 的 `TIMED_OUT`。missing owning run 仍作为不完整事实返回，由 runtime 通过安全恢复失败路径处理；gateway 不把数据不一致解释成已经完成。

## Deadline-driven Processing

每个 `AgentRequestLifecycleService` 只维护一个 unresolved-fact reconciliation Promise、一个可取消 timer、timer 对应的最早 wake-up epoch 和仅供 dependency failure 使用的 bounded retry attempt。`startPendingInputTimeoutProcessing()` 启动 deadline-driven reconciliation，不启动固定 cadence polling。

启动顺序固定为：

1. `recoverLocalRuntime()` 在 server listen 前执行 startup reconciliation；
2. recovery 根据所有 unresolved facts 处理 due/incomplete facts并计算最早 future deadline；
3. app 调用 `startPendingInputTimeoutProcessing()`；已有 future deadline 直接 arm timer，未完成 reconciliation 时请求一次立即 pass；
4. server 才进入 listen/readiness。

所有能 durable create 带 `timeoutAt` pending input 的 producer 在写入成功后调用 runtime-private `onPendingInputCreated(timeoutAt)`：更早 deadline 替换现有 timer，更晚 deadline 不推迟已有 timer；scheduler 尚未 start 时只记录最早 deadline；已到期 deadline 请求立即 reconciliation。通知失败不得回滚已经提交的 pending fact，startup/retry 仍可恢复。

每次 reconciliation 固定一个 runtime clock cutoff，以 100 条 keyset page 遍历全部 unresolved facts：

- due `PENDING`：CAS 为 `TIMED_OUT`，再完成 event 与 terminal commit；
- future `PENDING`：不改事实，只参与计算最早 wake-up；
- incomplete `TIMED_OUT`：不重复 CAS，继续缺失的 event 与 terminal commit；
- answered、canceled 和 terminal committed facts 由 gateway 排除。

同一 runtime instance 同时至多一个 processing flow。timer 在 active pass 期间触发时只设置一次 pending reconcile request；active pass结束后补一次，不并发进入。返回满页时从末条 fact 派生下一页 cursor并让出 event loop，直到遍历完成，不能因 future fact 排在 incomplete fact 前面而提前停止。

## Timeout 收敛与 Terminal Hook

到期结果必须最终收敛为 `PendingInput.status=TIMED_OUT`、canonical `USER_INPUT_TIMEOUT` 和 RequestRun `FAILED/PENDING_INPUT_TIMEOUT` terminal commit。状态 CAS、event publication 和 terminal commit 使用既有确定性幂等边界；并发 answer/cancel/timeout 保留先完成的合法结果。

timeout terminal context 设置既有 runtime-private `skipTerminalLifecycleHook` flow variable，只对 `PENDING_INPUT_TIMEOUT` 跳过 `BEFORE_AGENT_TERMINAL` hook，避免 timeout terminalization 再创建 replacement pending input。reject、deny、正常回答和其他 terminal path 保持默认 hook 语义。

Frontend countdown 只显示剩余时间或过期状态。只有 canonical timeout/history/stream fact 到达后，response surface 才退出并恢复普通 Composer；late answer 必须由 runtime 返回安全 timeout/conflict outcome，不能恢复原 run或把 fact改回 `RECEIVED`。

## 失败、恢复与关闭

单条 fact 失败只记录安全 coordinates并继续处理后续 fact。完成全部 page 后若存在失败，runtime 使用 1 秒起步、最大 30 秒的指数退避；成功 reconciliation 清零 attempt。下一次 wake-up 取 failure retry 与最早 future deadline中更早者。健康 idle 期间只保留 deadline timer，不固定查询数据库。

进程重启后由 startup reconciliation 恢复；当前 local 能力不承诺另一个已经存活的进程接收即时 create notification，也不提供 distributed scheduler、leader election 或跨进程 timer transfer。多进程短暂重叠依赖 scoped CAS 与确定性幂等边界去重。

系统关闭开始后 runtime 取消 timer并拒绝启动新 processing flow；active pass只在既有 bounded close budget 内结束。app 的 close 顺序必须在关闭 gateway 前关闭 runtime。session composite delete 在删除 RequestRun 前、同一事务内删除该 session 的 `pending_inputs`，使已删除 session 不会继续被 timeout processing 发现。

## Scope、安全与诊断

Reconciliation 的 Agent Scope 只来自 app composition 注入的 `recoveryAgentId`。一次 Agent-scoped maintenance query可以返回该 Agent 下多个 Owner Scope，但每条后续 run load、CAS、event 和 terminal write都必须使用 record 自带的完整 Owner + Agent coordinates，不能合并或替换 owner。

缺少可信 Agent Scope、非法 limit/cursor、旧全局 due query 或跨 scope write必须 fail closed，不得回退为全局扫描。timeout diagnostics只记录安全业务 coordinates与既有 safe reason，不记录 raw prompt、answer、provider error、credential、路径或客户端 metadata。

## 验证关注点

- Contract/local gateway：future/due `PENDING`、incomplete `TIMED_OUT`、terminal exclusion、Agent隔离、Owner保留、稳定 keyset、非法 bounds 和旧 symbol negative assertions。
- Runtime：健康 idle零轮询、早 deadline抢占、101+ facts分页、single-flight、partial failure backoff、startup recovery、close与多实例 CAS。
- Terminal：`BEFORE_AGENT_TERMINAL -> PEND` 不能在 timeout path创建 replacement pending input。
- Persistence：session delete事务清除 pending facts且不影响其他 scope。
- Projection：后台 session从 `WAITING_FOR_INPUT` 变为 `UNREAD_FAILURE`，切回后恢复普通 Composer；frontend不获得 timeout authority。
