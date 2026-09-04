## 背景和现状（Context）

NextAgent 的 runtime 通过 `streamSubscribers` Map 管理 SSE/WS stream 订阅者。`addStreamSubscriber` 将 subscriber 加入 per-stream-key Set，`publishTimelineEvent` 向匹配 subscriber 的 queue push 事件，`nextSubscriberEvent` 从 queue 读取或在 queue 空时通过 Promise 等待。当前已有 `harden-channel-input-security-boundaries` 修复了 SSE 订阅者泄漏（finally 块调用 `iterator.return()`），但连接数、队列大小、空闲超时和重放总量均无限制。

约束：
- AGENTS.md 规格优先：安全边界变更必须先有 OpenSpec change（本 change）。
- 同形同策：所有 stream 资源限制使用固定常量，不可由客户端覆盖；SSE 和 WS 通道使用同一 subscriber 管理逻辑。
- 最小内核非回归：不修改 conversation 历史响应形状、stream envelope 语义或 runtime lifecycle。
- 外科手术式修改：只加资源限制约束，不改既有行为。

相关方：`agent-runtime`（subscriber 管理、queue、重放循环）、`agent-session`（Catalog 缓存）。

## 目标和非目标（Goals / Non-Goals）

**目标：**

- `addStreamSubscriber` MUST 限制 per-stream-key subscriber 数量不超过 `maxSubscribersPerStream`（10），超限抛 safe error。
- `nextSubscriberEvent` MUST 在队列空等待超过 `subscriberIdleTimeoutMs`（300000ms / 5 分钟）时关闭 subscriber。
- `publishTimelineEvent` 和 `publishLiveTimelineEvent` MUST 在 queue 长度超过 `maxSubscriberQueueEvents`（1000）时丢弃 LIVE_ONLY 事件；超过 `subscriberQueueHardLimit`（2000）时移除 subscriber 并 abort。
- Timeline 重放 `while(true)` 循环 MUST 限制总事件数不超过 `maxReplayTotalEvents`（10000），总时间不超过 `maxReplayDurationMs`（30000ms），且每批读取后 MUST 检查 `request.signal?.aborted`。
- `CategoryQuestionCatalog.cache` MUST 使用 maxSize 受限（64）的 LRU 淘汰策略。

**非目标：**

- 不引入 SSE/WS 全局连接数限制（per-stream-key 限制已覆盖主要攻击面；全局限制需后续 change 评估）。
- 不引入 timeline prune/trim/evict 机制（需后续 change 评估持久化层影响）。
- 不引入 subscriber queue 溢出时的降级事件通知（drop 策略为静默丢弃 LIVE_ONLY + 超硬限关闭连接，足够防止 OOM）。
- 不修改 channel auth profile（DEFAULT_WEB loopback 信任模式是本地开发设计预期）。
- 不引入配置化资源限制参数（全部为固定常量）。
- 不修改 heartbeat / keepalive 机制（空闲超时通过 subscriber 关闭实现，不引入新的 heartbeat event）。

## 设计决策（Decisions）

### D1：maxSubscribersPerStream 数值选择

| 约束 | 数值 | 理由 |
|---|---|---|
| per-stream-key subscriber 上限 | 10 | 正常使用 1-3 连接（用户多标签页）；10 覆盖边缘场景；超过 10 的连接不属于正常前端行为 |

stream key 为 `(tenantId, subjectId, agentId, sessionId)` 维度。同一 session 的多标签页、多设备共享同一 stream key。10 足以覆盖正常多设备场景，同时防止攻击者对同一 session 打开大量连接。

- 放弃「全局连接数限制」：per-stream-key 限制已覆盖主要攻击面（攻击者需对不同 session 分散连接，每个 session 最多 10 个 subscriber）。全局限制需引入跨 session 计数器，增加复杂度。
- 超限处理：`addStreamSubscriber` 抛 `AgentError({ code: "STREAM_SUBSCRIBER_LIMIT_EXCEEDED" })`。SSE 路径返回 503 Service Unavailable；WS 路径发送 close frame（1013 Try Again Later）。
- 放弃「per-tenant 全局限制」：owner scope 隔离已确保跨租户不共享 subscriber；per-stream-key 限制已足够。

### D2：订阅者队列高水位策略

| 约束 | 数值 | 理由 |
|---|---|---|
| soft limit（丢弃 LIVE_ONLY） | 1000 | 正常消费 queue 长期接近 0；1000 覆盖短暂背压积累 |
| hard limit（关闭 subscriber） | 2000 | soft limit 的 2 倍；超过说明消费者长期不可用 |

`publishTimelineEvent` 和 `publishLiveTimelineEvent` 在 `queue.push` 前检查 `queue.length`：
- `queue.length >= maxSubscriberQueueEvents`（1000）：如果是 LIVE_ONLY 事件，跳过 push（静默丢弃）；如果是 PERSISTED 事件，仍然 push（持久化事件不可丢失，客户端重连时可重放）。
- `queue.length >= subscriberQueueHardLimit`（2000）：移除 subscriber 并调用 `subscriber.wake?.()` 触发 abort，live-tail 循环退出。transport 层关闭连接。

- 放弃「drop PERSISTED 事件」：PERSISTED 事件是 canonical timeline 事实，丢失会导致客户端 sequence gap。LIVE_ONLY 事件不持久化，丢弃后客户端重连可从 `lastSeenSequence` 恢复。
- 放弃「发降级事件通知客户端」：drop 策略为静默丢弃 LIVE_ONLY + 超硬限关闭连接。关闭连接后客户端通过既有 reconnect 逻辑恢复，无需额外的降级事件。
- `publishTimelineEvent` 运行在请求执行管道上（非 subscriber async generator 链上），push 不受 SSE 消费者背压影响。因此 high watermark 检查在 push 侧执行，不在消费侧。

### D3：subscriberIdleTimeoutMs 数值选择

| 约束 | 数值 | 理由 |
|---|---|---|
| 空闲超时 | 300000ms（5 分钟） | Agent 响应通常 < 2 分钟；5 分钟覆盖长任务思考；超过 5 分钟无任何事件大概率是僵尸连接 |

`nextSubscriberEvent` 当前在队列空时返回 `new Promise(resolve => { subscriber.wake = resolveNext; ... })`，无限等待。修改为 `Promise.race([waitPromise, timeoutPromise])`：
- `waitPromise`：既有逻辑，队列有事件或 signal abort 时 resolve。
- `timeoutPromise`：`setTimeout` 在 `subscriberIdleTimeoutMs` 后 resolve `undefined`。
- 超时时返回 `undefined`，live-tail 循环收到 `undefined` 后 `return`（退出循环），transport 层关闭连接。

- 放弃「heartbeat + 重置超时」：heartbeat 需要在 stream delivery 层引入新的 event 类型或 SSE comment，增加复杂度。空闲超时直接关闭连接更简单，客户端通过既有 reconnect 逻辑恢复。
- 放弃「更短超时（如 30s）」：Agent 长任务（如复杂 workflow 执行）可能数分钟无 stream event 产出。30s 会误杀正常连接。5 分钟在安全性和可用性之间取得平衡。
- 超时清理：`setTimeout` 在 `nextSubscriberEvent` 返回后 `clearTimeout`，避免泄漏。
- `request.signal?.aborted` 检查在 `nextSubscriberEvent` 入口已有，超时与 abort 互不干扰。

### D4：Timeline 重放总量限制与 abort 检查

| 约束 | 数值 | 理由 |
|---|---|---|
| 总事件数上限 | 10000 | `maxReplayBatchEvents = 1000`，10 批共 10000 事件覆盖正常 session 历史 |
| 总时间上限 | 30000ms（30 秒） | 防止慢查询导致长时间阻塞；30 秒覆盖正常分批读取 |
| abort 检查 | 每批读取后 | 对齐 live-tail 循环的 `while (!request.signal?.aborted)` 模式 |

`streamOwned` 的 `while(true)` 重放循环修改：
- 在循环外初始化 `replayedCount = 0` 和 `replayStartTime = Date.now()`。
- 每批读取后：`replayedCount += records.length`；`if (replayedCount > maxReplayTotalEvents)` 抛 safe error。
- 每批读取后：`if (Date.now() - replayStartTime > maxReplayDurationMs)` 抛 safe error。
- 每批读取后：`if (request.signal?.aborted) return`（静默退出，不抛 error）。

- 放弃「字节上限」：事件 payload 大小不固定，字节计数需要在投影层逐事件累计，增加复杂度。事件数 + 时间双重限制已足够。
- 放弃「timeline prune」：timeline prune/trim 涉及持久化层和 canonical timeline 语义，需独立 change 评估。本 change 通过重放限制防止资源耗尽，不修改 timeline 存储。
- 超限 error：抛 `AgentError({ code: "STREAM_REPLAY_LIMIT_EXCEEDED", category: "UNAVAILABLE", retryable: true })`。transport 层将其映射为 safe error 关闭连接。
- abort 检查对齐 live-tail 模式：live-tail 循环（`streamLiveTailOwned` 和 `streamOwned` 的 live-tail 部分）已有 `while (!request.signal?.aborted)` 检查。重放循环此前遗漏，本 change 补齐。

### D5：CategoryQuestionCatalog LRU 缓存

| 约束 | 数值 | 理由 |
|---|---|---|
| maxCacheEntries | 64 | locale pattern 约束后合法键空间大幅缩小；64 覆盖多 agent × 多 locale 场景 |

`cache` 从 `new Map<string, CatalogCacheEntry>()` 替换为 maxSize 受限的 LRU：
- 使用简单的 LRU 实现：`Map` 保持插入顺序，`get` 时 delete + re-set 将条目移到末尾（最近使用），`set` 时如果 `size > maxCacheEntries` 则删除第一个条目（最久未使用）。
- 不引入外部 LRU 库依赖。
- `loading` Map 和 `unavailable` Map 不受 LRU 影响（`unavailable` 已有 `MAX_SOURCE_AVAILABILITY_STATES = 256` 上限）。

- 放弃「TTL 过期」：Catalog 数据在应用生命周期内不可变（文件变更后需重启应用）。TTL 无实际意义，LRU 淘汰足够。
- 放弃「更大 maxSize」：locale pattern 后合法 locale 数量有限（通常 < 10），多 agent 场景下 64 足够。即使所有条目都在缓存中，64 条也不会造成内存压力。

### D6：Pending input 等待不算空闲超时

| 约束 | 值 | 理由 |
|---|---|---|
| pending input 期间超时 | 不超时 | USER_INPUT_REQUIRED 到 USER_INPUT_RECEIVED 之间的等待是用户交互时间，最长可达 defaultRequestTimeoutMs（1800000ms / 30 分钟）；5 分钟空闲超时会误杀正常 pending input 连接 |


`nextSubscriberEvent` 的 `Promise.race` 中 `timeoutPromise` 分支：当 `subscriber.pendingInputActive` 为 true 时，跳过 `subscriberIdleTimeoutMs` 超时（仅保留 `waitPromise` + `signal.aborted`）。这样当 Agent 在等待用户回答 pending input 时，SSE/WS 连接不会被 5 分钟空闲超时关闭。

pendingInputActive 状态维护：
- `publishTimelineEvent` 在 `subscriber.queue.push(liveEvent)` 后，如果 `liveEvent.type` 为 `USER_INPUT_REQUIRED` 则设置 `subscriber.pendingInputActive = true`；如果为 `USER_INPUT_RECEIVED`、`USER_INPUT_TIMEOUT`、`USER_INPUT_CANCELED` 则重置为 false。
- streamOwned 重放循环中，遍历到同类事件时同步更新一个局部变量，replay 结束后将值赋给 subscriber.pendingInputActive。
- streamLiveTailOwned 不需要，因为 live-tail subscriber 不通过 replay 加入，只在后续由 publishTimelineEvent 驱动。

- 放弃「取消空闲超时并在 pending input 后重新计时」：增加复杂度，且无法解决正在等待中 pending input 的活连接。
- 放弃「分离 pending input 线程」：subscriber 是 per-connection 的，pending input 状态和 stream 线程共享同一个等待循环。

### D7：lastSeenSequence=0 等于 undefined（不全量重放）

lastSeenSequence=0 等价于没有 anchor：走 streamLiveTailOwned，仅追新事件，不重放历史。streamEvents 和 stream 方法中 lastSeenSequence === 0 和 lastSeenSequence === undefined 分支到同一个路径（不重放）。

关键约束：filter-aware 路由。当 requestId 或 runId filter 存在时，lastSeenSequence=0 是有效 anchor（如 subagent-execution-port 使用 0 + requestId + runId 从头重放子请求事件），此时走 streamOwned 重放路径（受 D4 的 maxReplayTotalEvents 和 maxReplayDurationMs 限制）。仅当 lastSeenSequence=0 且无 filter 时才走 live-tail。

逻辑：
- assertValidTimelineAnchor 已接受 0（为非负安全整数），因此需要在分支前判断。
- assertUnfilteredLiveTailQuery 对 undefined + filter 时抛 STREAM_REPLAY_ANCHOR_REQUIRED（filtered live-tail 无意义）；对 0 + filter 不触发，因为 0 + filter 走重放路径。
- 非零 anchor（如 lastSeenSequence=100）仍正常重放。maxReplayTotalEvents 和 maxReplayDurationMs 作为 defense-in-depth 保留。

- 放弃「保留 0 的全量重放」：无 filter 时 0 = live-tail，避免无 anchor 的全量重放攻击面。有 filter 时 0 仍走重放（subagent 合法用例），但受 D4 上限保护。
## 质量属性设计（Quality Attributes）

| 质量属性 | 设计结论 | 验证入口 |
|---|---|---|
| 安全 | 连接数限制防止资源耗尽 DoS；队列高水位防止 OOM；重放限制防止 CPU 耗尽 | subscriber 限制测试、queue 高水位测试、重放限制测试 |
| 性能/容量 | LRU 缓存限制内存占用；空闲超时释放僵尸连接资源 | LRU 淘汰测试、空闲超时测试 |
| 可靠性/恢复 | 超限返回 safe error，不影响其他请求；subscriber 关闭后客户端可 reconnect | 负面测试断言 safe error |
| 可维护性 | 所有上限为单一常量来源；SSE 和 WS 共用 subscriber 管理逻辑 | `npm run lint:architecture`；code review |
| 可测试性 | 连接数限制可用边界值验证；queue 高水位可用构造事件验证；LRU 可用填充+淘汰验证 | characterization 测试 |
| 审计/可追溯 | 超限失败通过既有 safe error 通道返回；无新增可观测信号需求 | 既有 observability 断言路径 |

## 验证映射（Verification Map）

| 约束 | Task | 验证入口 |
|---|---|---|
| subscriber 连接数限制 | T1 | `npm test -- ...agent-runtime` subscriber 限制测试 |
| 队列高水位 drop LIVE_ONLY | T2 | `npm test -- ...agent-runtime` queue 高水位测试 |
| 队列硬限关闭 subscriber | T2 | `npm test -- ...agent-runtime` queue 硬限测试 |
| 空闲超时关闭 subscriber | T3 | `npm test -- ...agent-runtime` 空闲超时测试 |
| 重放总量上限 | T4 | `npm test -- ...agent-runtime` 重放限制测试 |
| 重放 abort 检查 | T4 | `npm test -- ...agent-runtime` abort 测试 |
| LRU 淘汰 | T5 | `npm test -- ...agent-session` LRU 测试 |

## 文档承载决策（Documentation Ownership）

- 行为契约：`openspec/specs/ts-web-sse-ws-transports/spec.md`（连接限制 + 空闲超时 + 队列高水位）、`openspec/specs/ts-stream-resume-replay/spec.md`（重放限制）、`openspec/specs/category-question-source/spec.md`（LRU）。
- 模块设计：`openspec/designs/modules/agent-runtime.md`（subscriber 常量 + 重放常量）、`openspec/designs/modules/agent-session.md`（LRU 常量）。
- ADR：无（决策复杂度不足以单独立 ADR，记录在本 design）。
- 导航：`openspec/designs/spec-to-design-map.md` 新增 `harden-stream-resource-limits` 条目。

## 风险与取舍（Risks / Trade-offs）

- [空闲超时可能关闭长任务等待连接] -> 设计如此：5 分钟超时覆盖正常 Agent 响应时间（通常 < 2 分钟）；超时后客户端通过既有 reconnect 逻辑恢复，`lastSeenSequence` 保证不丢事件。如后续发现误杀，可通过 OpenSpec change 调整超时值。
- [队列高水位丢弃 LIVE_ONLY 事件可能导致客户端遗漏实时状态] -> 可接受：LIVE_ONLY 事件不持久化，丢弃后客户端 reconnect 可从 `lastSeenSequence` 恢复持久化事件。实时状态（如 LLM_THINKING_DELTA）在重连后从最新状态继续。
- [重放总量上限可能导致大 session 无法全量重放] -> 可接受：10000 事件覆盖正常 session 历史。超大 session 的客户端应使用 conversation history API 分页加载，而非全量 stream 重放。超限返回 retryable safe error。
- [LRU 淘汰可能导致热 locale 被误淘汰] -> 风险极低：locale pattern 约束后合法 locale < 10，64 条缓存足以容纳所有 agent × locale 组合。

## 迁移计划（Migration）

无数据迁移。所有约束为运行时判定，对存量数据无影响。SSE/WS 连接超限返回 safe error，前端既有 error handling 逻辑已覆盖 503 / close frame 场景。发布无需特殊步骤；回滚即还原代码，无持久化格式变化。

## 归档前更新基线（Baseline Promotion Plan）

- `openspec/specs/ts-web-sse-ws-transports/spec.md`：合并连接数限制、空闲超时和队列高水位 requirement。
- `openspec/specs/ts-stream-resume-replay/spec.md`：合并重放总量限制和 abort 检查 requirement。
- `openspec/specs/category-question-source/spec.md`：合并 LRU 淘汰 requirement。
- `openspec/overview.md`：安全边界描述补充 stream 资源限制加固。
- `openspec/designs/modules/`：`agent-runtime` 与 `agent-session` 模块设计补充对应常量和策略。
- `openspec/designs/spec-to-design-map.md`：新增 `harden-stream-resource-limits` 导航。

## 待确认问题

无。

## 长期基线刷新计划

本节将旧模板的“归档前更新基线”归一为可审计的归档门禁；以下均为**归档前待执行**，不表示 stable baseline 已刷新。

- **Function：**以 `FN-1.1-查看会话消息流` 为唯一用户可见行为 owner；若本 change 增加的行为不能被该 Function 的既有边界完整表达，先在同一能力域新增一个单一职责 Function，再更新 `openspec/designs/functions/index.md`，不得把实现细节直接写入 Function。
- **Stable spec：**将 delta Requirement 合并至 `openspec/specs/category-question-source/spec.md`、`openspec/specs/ts-stream-resume-replay/spec.md`、`openspec/specs/ts-web-sse-ws-transports/spec.md`，逐条核对 Requirement 标题、MUST/SHALL 语义、场景、迁移和 metadata；不得以 `--skip-specs` 绕过同名 Requirement 重叠。
- **长期设计：**先执行本 design/proposal 已列出的“归档前更新基线”设计 owner；再在 `openspec/designs/spec-to-design-map.md` 为上述 stable spec 写入该 Function、实际承载的 architecture/module/ADR 与验证入口。若现有 map 无该 spec 行，先创建该行，而非把 change-local design 当作长期设计。
- **归档判定：**Function、stable spec、长期设计和 map 四端均完成 diff 审阅且 `openspec validate --all --strict` 通过后，才允许归档；任一端无法唯一归属时保留 active 并标记阻塞。
