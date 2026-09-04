## 背景与问题（Why）

vuln_agent 安全扫描在 `.vuln_agent_output/` 中确认了 25 条 VULN 前缀发现。其中 15 条已在 `harden-channel-input-security-boundaries` change 中修复（P0/P1：路径穿越、limit DoS、SSE 订阅者泄漏、WebSocket 帧大小、SkillHub 完整性、输入 maxLength/maxItems、SSRF）。剩余发现涉及 SSE/WS 资源耗尽、timeline 全量重放和缓存无淘汰，被标记为需后续架构设计的 P2/P3 项。本 change 收敛仍存在于当前产品路径的资源限制问题。

1. **P2 SSE/WS 无连接数限制**：`addStreamSubscriber` 只做 `Set.add()`，无 maxSubscribers 检查。攻击者可打开无限数量 SSE/WS 连接，每个连接占用 subscriber + queue 内存。影响 session SSE（#16）、task SSE（#18）和 WebSocket session stream（#20）。
2. **P2 SSE/WS 无空闲超时**：live-tail 循环 `while (!request.signal?.aborted)` 无服务端空闲超时。`nextSubscriberEvent` 队列空时通过 Promise 无限等待。攻击者打开连接后保持沉默即可永久挂起。属于 #16/#18。
3. **P2 订阅者队列无大小限制**（#17）：`publishTimelineEvent` 直接 `queue.push()` 无 length 检查。消费者背压暂停时 queue 无界增长，5 秒背压窗口内可积累大量事件导致 OOM。
4. **P2 Timeline 全量重放无限制 + 无 abort 检查**（#24）：`while(true)` 重放循环仅在 `records.length < maxReplayBatchEvents` 时退出，无总事件数、时间、字节上限，循环内不检查 `request.signal?.aborted`。`?lastSeenSequence=0` 触发全量重放可耗尽 CPU 和内存。
5. **P3 缓存 Map 无 LRU 淘汰**（#7/#8）：`CategoryQuestionCatalog` 的 `cache = new Map()` 无 maxSize/LRU/eviction。locale pattern 已大幅缩小合法键空间，但 Map 仍无淘汰机制。

## 变更范围（What Changes）

### SSE/WS 连接数限制与空闲超时

- `agent-runtime/src/lifecycle/submit.ts` 的 `addStreamSubscriber` 添加 `maxSubscribersPerStream` 检查，超限抛 safe error。
- `nextSubscriberEvent` 添加 `subscriberIdleTimeoutMs` 超时：队列空等待超过阈值时关闭 subscriber（返回 undefined 退出 live-tail 循环）。

### 订阅者队列高水位

- `agent-runtime/src/lifecycle/submit.ts` 的 `publishTimelineEvent` 和 `publishLiveTimelineEvent` 在 `queue.push` 前检查 `queue.length`：超过 `maxSubscriberQueueEvents` 时丢弃 LIVE_ONLY 事件；超过 `subscriberQueueHardLimit` 时移除 subscriber 并 abort。

### Timeline 重放限制与 abort 检查

- `agent-runtime/src/lifecycle/submit.ts` 的 `streamOwned` 重放 `while(true)` 循环添加总事件数上限 `maxReplayTotalEvents`、总时间上限 `maxReplayDurationMs`，并在每批读取后检查 `request.signal?.aborted`。

### LRU 缓存淘汰

- `agent-session/src/services/category-question-catalog.ts` 的 `cache` 从无界 `Map` 替换为 maxSize 受限的 LRU 淘汰策略，`maxCacheEntries = 64`。

### Stream subscriber 空闲超时 pending input 豁免

- `agent-runtime/src/lifecycle/submit.ts` 的 `nextSubscriberEvent` 在 subscriber 处于 pending input 等待状态时 MUST NOT 触发空闲超时。`publishTimelineEvent` 在推送 USER_INPUT_REQUIRED 事件后设置 subscriber.pendingInputActive = true，在推送 USER_INPUT_RECEIVED、USER_INPUT_TIMEOUT、USER_INPUT_CANCELED 事件后重置为 false。重放路径中遍历到这些事件时同步更新 pendingInputActive 状态。

### Timeline 重放 lastSeenSequence=0 跳过

- `agent-runtime/src/lifecycle/submit.ts` 的 streamEvents 和 stream 方法在 lastSeenSequence 为 0 且无 filter 时 MUST 与 undefined 等价处理，走 live-tail 路径（不重放）。有 filter 时 0 仍走重放路径（subagent 合法用例），受 D4 重放上限保护。

## Capability 影响（Capabilities）

### 修改的 Capability

- `ts-web-sse-ws-transports`：新增 stream subscriber 连接数限制、空闲超时和队列高水位行为约束。
- `ts-stream-resume-replay`：新增 timeline 重放总量限制和 abort 检查行为约束。
- `category-question-source`：新增内存 Catalog LRU 淘汰行为约束。

## 影响范围（Impact）

- 代码：`agent-runtime`（subscriber 管理、queue 高水位、重放限制）、`agent-session`（LRU 缓存）。
- API：无新增字段；SSE/WS 连接超限返回 safe error（SSE 503，WS close frame 1013）。
- 测试：subscriber 连接数限制测试、queue 高水位 drop 测试、重放总量上限测试、LRU 淘汰测试。
- 配置/运维：无新增配置；所有上限为固定常量，不可由客户端覆盖。

## 归档前更新基线（Baseline Promotion Plan）

**行为契约：**
- `openspec/specs/ts-web-sse-ws-transports/spec.md`：合并连接数限制、空闲超时和队列高水位 requirement。
- `openspec/specs/ts-stream-resume-replay/spec.md`：合并重放总量限制和 abort 检查 requirement。
- `openspec/specs/category-question-source/spec.md`：合并 LRU 淘汰 requirement。

**长期背景：**
- `openspec/overview.md`：在安全边界描述中补充 stream 资源限制加固一句。

**设计视图：**
- `openspec/designs/modules/agent-runtime.md`：补充 subscriber 限制常量和重放限制常量。
- `openspec/designs/modules/agent-session.md`：补充 LRU 缓存常量。
- `openspec/designs/spec-to-design-map.md`：新增 `harden-stream-resource-limits` 导航条目。

**验证入口：**
- `agent-runtime` subscriber 限制测试：超限连接被拒绝、queue 高水位 drop、重放总量上限、abort 检查。
- `agent-session` LRU 淘汰测试：超 maxSize 时最旧条目被淘汰。
