## 背景与问题（Why）

当前 runtime 只在接受新 submit 和 app startup recovery 时调用 pending input timeout 处理。若一个 pending input 在系统持续运行期间到期，同时没有新的 submit、没有进程重启，也没有其他会触发扫描的外部流量，durable fact 会长期停留在 `PENDING`。因此后端不会发布 canonical `USER_INPUT_TIMEOUT`，RequestRun 不会以 `PENDING_INPUT_TIMEOUT` terminalize，会话活动继续显示 `WAITING_FOR_INPUT`，用户切回会话后仍看到已经过期的响应控件。

前端本地倒计时按既有契约只负责显示，不能自行清除 pending input 或恢复 Composer；会话活动投影同样只能消费已提交 canonical facts，不能替代 runtime 推进生命周期。真实缺口是 runtime 没有在无外部流量时持续推进已经接受的 timeout 事实。

本 change 依赖 `refine-ts-pending-input-timeout-contracts` 先完成冻结 gateway timeout candidate contract 的替换。生命周期实现只消费该唯一契约，不重新定义或兼容旧查询。

## 目标与非目标（Goals / Non-Goals）

**目标：**

- pending input 到达已持久化 `timeoutAt` 后，即使没有新 submit、会话切换、页面连接或进程重启，runtime 仍能在有界时间内推进 canonical timeout 生命周期。
- timeout 处理最终收敛为 `PendingInput.status=TIMED_OUT`、canonical `USER_INPUT_TIMEOUT` 和 RequestRun `FAILED/PENDING_INPUT_TIMEOUT` terminal commit。
- 任一中间步骤暂时失败后，后续处理能够从 durable facts 幂等恢复，不留下永久半完成状态。
- timeout terminalization 不得重新进入可能再次创建 pending input 的 terminal lifecycle hook。
- 非当前会话通过既有 session activity 投影从 `WAITING_FOR_INPUT` 变为 `UNREAD_FAILURE`；用户切回并加载 canonical history/stream 后看到普通 Composer，而不是过期响应控件。
- worker 始终限定在 app composition 注入的可信 Agent Scope 内，并能在 app close 时停止。

**非目标：**

- 不让 frontend、session activity、channel、Agent Core、Capability 或 model 拥有 timeout authority。
- 不修改 30 分钟默认 timeout、24 小时显式 timeout 上限或任何 pending kind 的 timeout 结果。
- 不新增固定扫描周期、per-Agent policy、per-Owner timer、每个 pending input 独立 timer 或第二套 scheduler。
- 不修改 SSE/WS payload、pending input answer API、session list API 或 session activity public shape。
- 不新增数据库表、持久化 observation、feed sequence、revision 或浏览器持久化状态。

## 变更范围（What Changes）

- 系统按已接受的最早 `timeoutAt` 推进 deadline，startup/recovery 立即处理 due 或 incomplete facts；健康空闲期间不按固定周期重复读取。
- 新接受的更早 deadline 必须在没有其他外部动作时仍及时生效，既有较晚 deadline 不得延迟它。
- timeout processing 以至多 100 条 facts 为一批，同一运行时实例不并发执行多条 processing flow；失败 fact 不阻塞后续 fact，依赖恢复后继续收敛。
- 到期 `PENDING` 收敛为 `TIMED_OUT`；已经 `TIMED_OUT` 但 terminal result 未完成的事实继续形成缺失的 canonical timeout event 与 `FAILED/PENDING_INPUT_TIMEOUT`。
- timeout terminalization 不得再次创建 pending input；reject、deny、正常回答和其他 terminal path 保持原行为。
- event、terminal result 或事实读取失败时系统保持可用；失败不得回滚 `TIMED_OUT`、恢复原 run 或阻止其他 eligible fact。
- 系统关闭开始后不得启动新的 timeout processing；session 删除成功后，该 session 的 pending-input facts 不得再被 timeout processing 发现。
- 通过既有 session activity 与 frontend pending-input 契约验证跨会话可见结果；除非 canonical event 已到达但既有投影错误，否则不修改这两个投影面的生产语义。

## Feature 影响（Features）

### 修改的 Feature

- `F-6.5 人工交互边界`：待确认输入在已接受期限到达后，即使没有新流量也会安全终止；用户不会继续看到已过期但仍可响应的交互表面。

## Function 影响（OpenSpec Capabilities）

### 新增 Function

无。

### 修改的 Function

- `FN-6.5 请求用户确认或授权` → canonical spec `human-pending-input-core`
  - 功能边界：把两个被触及的 legacy timeout Requirements 迁入主规格，并将完整目标态拆为 timeout 功能行为、空闲与容量、失败恢复和用户可见结果四个 Requirements；补充无外部流量持续推进、partial failure 恢复、可信 Agent Scope、批处理、关闭和跨会话可观察结果，确认、拒绝、授权与正常回答语义不变。
  - 系统质量属性：性能/容量（健康空闲期不固定轮询、单 timer、100 条批次）、可靠性/恢复（startup、partial failure、bounded backoff、关闭边界）、安全（可信 Agent Scope 与 late-answer fail closed）。
  - 映射说明：`human-pending-input-timeout` 中两个被触及的 legacy Requirements 作为来源整体 REMOVED，并以目标态迁入主规格 `human-pending-input-core`；未触及的 `Timeout never auto-approves` 原位保留，`confirmation-pending-input`、`authorization-pending-input` 等其他 legacy Requirements 不受影响。

## 影响范围（Impact）

- `packages/agent-runtime` 的 pending input timeout processing、terminal recovery、runtime lifecycle 与测试。
- `packages/agent-app` 的 startup/close composition 和可信 Agent Scope 注入。
- `packages/agent-platform-gateway-local` 的 candidate 查询消费与多实例测试。
- `packages/agent-session`、`packages/agent-channel-web` 和 `frontend/agent-web` 的既有 activity/Composer 集成回归测试。
- root contract、architecture、runtime、frontend build/test 与浏览器旅程验证。
