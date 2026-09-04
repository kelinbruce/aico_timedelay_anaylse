# Design: fix-ts-pending-input-timeout-lifecycle

## 设计范围

| Function | 目标变化 | delta specs | Function 设计章节 |
|---|---|---|---|
| FN-6.5 请求用户确认或授权 | 让已接受的 pending-input deadline 在无外部流量时仍由 runtime 持续推进，并从半完成事实恢复 | `human-pending-input-timeout`（REMOVED legacy Requirements）、`human-pending-input-core`（ADDED canonical Requirements） | 见下 |

## 存量 Requirement 迁移方案

| 来源 spec / Requirement | 目标 Function / canonical spec | 迁移结果 |
|---|---|---|
| `human-pending-input-timeout` / `Runtime resolves pending input timeout` | FN-6.5 / `human-pending-input-core` | 来源 Requirement 整体 REMOVED；功能目标态迁入同名 ADDED Requirement，并把新增的空闲/容量与失败恢复义务分别拆为 `Timeout processing remains idle and bounded`、`Timeout processing recovers safely from interruption`。 |
| `human-pending-input-timeout` / `Timeout is visible and rejects late answers` | FN-6.5 / `human-pending-input-core` | 来源 Requirement 整体 REMOVED；完整目标态以同名 ADDED Requirement 迁入主规格。 |

来源 spec 的 `Timeout never auto-approves` 未被本 change 触及，继续原位保留；本 change 不退役 `human-pending-input-timeout`。

## FN-6.5 请求用户确认或授权

### 目标与规范依据

系统在 pending input 的已接受 deadline 到达后，无需新 submit、页面连接或重启即可推进 timeout；失败可从 durable facts 恢复，超时终态不再次请求输入，用户最终看到 canonical timeout 结果并无法提交迟到回答。

本 Function 的目标 Requirements：

- canonical spec：`human-pending-input-core`
- ADDED：`Runtime resolves pending input timeout`、`Timeout processing remains idle and bounded`、`Timeout processing recovers safely from interruption`、`Timeout is visible and rejects late answers`
- legacy source：`human-pending-input-timeout` 的两个同名 Requirements（REMOVED）

### 当前实现

`packages/agent-runtime/src/lifecycle/submit.ts` 已实现单条 timeout 的 durable 收敛：

- 到期 `PENDING` 使用 CAS 变为 `TIMED_OUT`；
- `TIMED_OUT` 且 terminal 未完成的事实可以继续发布 `USER_INPUT_TIMEOUT` 并提交 `FAILED/PENDING_INPUT_TIMEOUT`；
- event、resolve 与 terminal commit 使用确定性幂等边界；
- answer path 在写入前重新检查 deadline 并拒绝 late answer。

当前 change 新增了每秒一次的 one-shot polling。即使没有 pending input，每个 runtime instance 仍固定查询 SQLite。查询整体失败或单条失败依赖下一秒再次扫描。该实现能推进 timeout，但把已知的 durable deadline 转化成持续数据库探测。

当前 timeout terminalization 使用 `toPendingInputTerminalContext(...)`，其 `flowVariables` 为空，因此 `commitTerminal(...)` 仍可能执行 `BEFORE_AGENT_TERMINAL` hook。若该 hook 返回 `PEND`，超时终止会再次创建 pending input。

当前 `deleteSessionCascade(...)` 删除 RequestRun 前没有删除 `pending_inputs`。terminal session 删除后会留下无法加载 owning run 的 timeout fact，并被后台 reconciliation 反复发现。

`agent-session` activity 和 `frontend/agent-web` 已能消费 canonical `USER_INPUT_TIMEOUT` 与 terminal fact。它们不拥有 timeout decision，本 change 不修改其生产语义。

### GAP 分析

1. 固定一秒 polling 把已知 deadline 退化为持续数据库探测，健康空闲期仍产生查询。
2. 半完成 timeout 只能依赖下一轮扫描恢复，且 timeout terminal context 可能再次进入创建 pending input 的 hook。
3. session 删除未清理 pending facts，可能留下无法加载 owning run 的候选。
4. 需要保留 runtime authority、可信 Agent Scope、canonical event/terminal commit 和 frontend/activity 只读投影边界。

### 修改方案

#### 一个 runtime timer

`AgentRequestLifecycleService` 保留 package-public `startPendingInputTimeoutProcessing(): void`，但它只启动 deadline-driven reconciliation，不启动固定 cadence loop。

每个 runtime instance 只维护：

- 一个 unresolved-fact reconciliation Promise，保证 single-flight；
- 一个可取消的 timer；
- timer 对应的最早 wake-up epoch；
- 仅在依赖失败时使用的 bounded retry attempt。

app 顺序保持：

1. `recoverLocalRuntime()` 在 server listen 前执行一次 timeout reconciliation；
2. recovery best-effort 返回后，app 调用 `startPendingInputTimeoutProcessing()`；
3. recovery 已成功计算 future deadline 时，start 直接按该 deadline arm timer；若 recovery 未完成 reconciliation，start 请求一次立即 reconciliation；
4. close 先停止 timer并阻止新 reconciliation，再按现有 close budget drain active pass，之后 app 才关闭 gateway。

timer 使用 `unref()`。delay 由 `max(0, timeoutAt - runtimeClockNow)` 计算；timer 触发后必须重新读取 durable facts和当前 runtime clock。进程休眠导致触发变晚时立即处理 due fact；提前触发时重新 arm，不提前 timeout。

#### Durable create 后的显式通知

runtime 中所有带 accepted `timeoutAt` 的 pending-input producer 在 `createPendingInput(...)` durable write 成功后调用同一个 runtime-internal callback：

```ts
onPendingInputCreated(timeoutAt)
```

callback 只比较并更新当前 runtime 的最早 wake-up：

- 新 deadline 更早时取消并替换旧 timer；
- 新 deadline 更晚时保留旧 timer；
- scheduler 尚未 start 时仅记录最早 deadline，等待 start；
- deadline 已到期时请求一次立即 reconciliation。

该 callback 是 `agent-runtime` 内部依赖，不进入 `agent-contracts/runtime`，也不包装或改变 `PendingInputStoreGateway.createPendingInput` 的持久化语义。通知失败不得回滚已经成功的 durable create；创建事实仍可由 startup reconciliation恢复。

#### Unresolved fact reconciliation

runtime 调用 refinement change 定义的唯一 gateway query：

```ts
listUnresolvedPendingInputTimeoutFacts({ agentId, limit, after })
```

每次 reconciliation 固定一次 runtime `now` 作为 due cutoff，并以 100 条 keyset page 扫描：

- `PENDING` 且 `timeoutAt <= cutoff`：执行现有 timeout CAS 与后续收敛；
- `PENDING` 且 `timeoutAt > cutoff`：不修改事实，只更新本次发现的最早 future deadline；
- `TIMED_OUT` 且 terminal 未完成：不重复状态转换，继续 event 与 terminal commit；
- `RECEIVED`、`CANCELED` 和 terminal 已完成记录由 gateway 排除。

返回满页时从最后一条 record 的 `(timeoutAt, pendingInputId)` 构造 invocation-local cursor，让出 event loop 后继续下一页。reconciliation 必须扫描全部 unresolved page，以避免 future `PENDING` 排序在 incomplete `TIMED_OUT` 之前时漏掉恢复事实。100 是 batch limit，不是新的 session 容量。

单条失败只记录安全 coordinates并继续；完成全部 page 后，如果存在失败，runtime 安排 failure-only retry。retry 从 1 秒开始指数退避，最大 30 秒；成功 reconciliation 清零 attempt。下一次 wake-up取 failure retry 与最早 future deadline中的较早者。健康 idle 状态只保留 deadline timer，不执行周期查询。

若 timer 触发时已有 reconciliation，runtime 标记一次 pending reconcile request；active pass 结束后只补一次，不并发进入。

#### Timeout 专用 terminal context

`toPendingInputTerminalContext(...)` 增加 runtime-private option。只有 timeout path 传入 `skipTerminalLifecycleHook: true`，在 context 的 `flowVariables` 中写入现有 `skipTerminalLifecycleHookKey`。

这样 timeout 仍然：

- 发布 canonical `USER_INPUT_TIMEOUT`；
- terminal commit 为 `FAILED/PENDING_INPUT_TIMEOUT`；
- 触发既有 session activity 与 frontend 投影；

但不会再次进入 `BEFORE_AGENT_TERMINAL` hook。reject、deny、human-handoff final answer和其他 terminal path继续使用默认 context，不改变现有语义。

#### Session delete cleanup

local gateway 的 `deleteSessionCascade(...)` 在同一事务中、删除 RequestRun 之前，按 tenant、subject、agent、session 坐标删除 `pending_inputs`。不新增 session-delete event或 scheduler notification；若内存 timer仍指向已删除事实，到点后的 durable reconciliation自然忽略并计算下一 deadline。

#### Owner 与投影边界

reconciliation 的 Agent Scope继续使用 app composition 注入的 `recoveryAgentId`。返回 record 自带的 tenant/subject coordinates逐条用于 owning run load、CAS、event 与 terminal write，不跨 Owner Scope合并。

frontend、session activity、channel、Agent Core、Capability 与 model不参与 deadline计算和 timeout write。多进程短暂重叠继续依靠 CAS 与确定性幂等边界去重；本 change 不新增跨进程即时唤醒或分布式 scheduler。

#### 备选方案

固定一秒 polling 在健康空闲期持续读取数据库，与已经持久化的确定 deadline重复，未采用。

为每条 pending input建立独立 timer会让 timer数量与 pending数量绑定，并需要复杂的取消与恢复注册，未采用。

由 frontend countdown清除 pending input会破坏多设备 canonical truth和 runtime authority，未采用。

新增第二个 next-deadline gateway方法会与 due query形成两套重叠 timeout read contract。refinement change改为返回全部 unresolved durable facts，让 runtime在一个分页 flow中处理 due、恢复 incomplete并计算下一 deadline。

复用 scheduled maintenance或新增持久化 scheduler会扩大 owner与数据模型，超过当前问题，未采用。

#### 质量属性影响

- 性能：健康 idle期间零固定扫描；每个 runtime最多一个 timer和一个 reconciliation。
- 容量：100 条 keyset page，扫描范围受当前 Agent Scope 的 Owner+Agent session容量约束。
- 可靠性：durable facts是唯一 truth；startup、deadline、create notification和failure backoff最终汇入一个 single-flight reconciliation。
- 安全：只使用可信 Agent Scope和 record自带 Owner Scope；不新增 Web/channel authority。
- 可维护性：沿用现有 timeout CAS、event、terminal commit与 close边界；新增状态只服务一个 timer。
- 可测试性：fake clock/timer验证无 polling、deadline抢占、休眠延迟、failure backoff、close、partial recovery和 terminal-hook skip。

## 验证策略（Verification Strategy）

Gateway contract/integration tests覆盖 future/due `PENDING`、incomplete `TIMED_OUT`、keyset、Agent Scope和非法 request。Runtime tests先证明 scheduler start 后健康 idle不重复查询，再验证新建更早 deadline重设 timer、deadline到达自动处理、partial failure backoff、single-flight、分页和 close。

新增 timeout terminal-hook regression：配置一个在 `BEFORE_AGENT_TERMINAL` 返回 `PEND` 的 hook，令已有 pending input自然超时，断言 hook未被调用且没有 replacement pending input。

local gateway composite-delete test持久化 terminal run与 pending input，删除 session后断言 pending fact不存在且 unresolved query不再返回。

保留 session activity、frontend和真实 product-path回归，证明 canonical timeout到达后后台 session变为 unread failure，切回恢复普通 Composer。最终运行相关 package build/test、root contract/architecture gate、两个 change strict validation和全库 strict validation。

## 长期基线刷新计划

- stable specs：从 `human-pending-input-timeout` 移除两个被触及 Requirements，并把其完整目标态作为 ADDED Requirements 合并到 `human-pending-input-core`；未触及的 `Timeout never auto-approves` 原位保留。
- Function：刷新 `FN-6.5 请求用户确认或授权` 的描述、处理过程、结果、量化指标、覆盖特性、主规格与遗留规格导航。
- Feature：刷新 `F-6.5 人工交互边界`，明确已接受 deadline 在无外部流量时仍会安全终止。
- architecture：新增或刷新 `pending-input-lifecycle.md` 的 runtime timeout processing、失败恢复和 scope 边界。
- modules：刷新 `agent-runtime.md` 的 timeout owner、启动、处理和关闭职责，以及 `agent-app.md` 的可信 Agent Scope 注入和 worker 生命周期管理。
- overview、ADR：无。
- spec-to-design-map：把两个迁移后的 timeout Requirements 导航到 `human-pending-input-core`，并保留 legacy `human-pending-input-timeout` 未触及 Requirement 的既有导航。

## 风险与取舍（Risks / Trade-offs）

startup reconciliation会读取当前 Agent Scope下全部 unresolved timeout facts，以得到最早 future deadline并恢复 incomplete事实；该读取不再每秒重复。若 future pending数量接近 Agent session容量上限，startup成本高于只查一条 next deadline，但避免新增第二个契约和调度 DTO。

dependency持续失败时会按最大 30 秒 backoff继续读取。这是明确故障恢复而非健康 polling；恢复后立即回到 deadline-only timer。

当前 timer是进程内能力。进程退出后由下一次 startup reconciliation恢复；本 change不承诺另一个已经存活的进程接收即时创建通知。

## 待确认问题（Open Questions）

无。
