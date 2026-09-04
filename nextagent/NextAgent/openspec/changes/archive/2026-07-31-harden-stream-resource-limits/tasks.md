## 1. SSE/WS 连接数限制

- [x] 1.1 在 `agent-runtime/src/lifecycle/submit.ts` 新增 `maxSubscribersPerStream = 10` 常量，在 `addStreamSubscriber` 中添加 `subscribers.size >= maxSubscribersPerStream` 检查，超限抛 `AgentError({ code: "STREAM_SUBSCRIBER_LIMIT_EXCEEDED", category: "UNAVAILABLE", retryable: true })`
  验证：`npm run build` 编译通过；`npm test -- ...agent-runtime` subscriber 限制测试通过
  来源：spec「Stream subscriber 连接数限制」、design D1

## 2. 订阅者队列高水位

- [x] 2.1 在 `agent-runtime/src/lifecycle/submit.ts` 新增 `maxSubscriberQueueEvents = 1000` 和 `subscriberQueueHardLimit = 2000` 常量
  验证：`npm run build` 编译通过
  来源：spec「订阅者队列高水位」、design D2
- [x] 2.2 在 `publishTimelineEvent` 的 `subscriber.queue.push(liveEvent)` 前添加高水位检查：`queue.length >= maxSubscriberQueueEvents` 时跳过 LIVE_ONLY 事件的 push；`queue.length >= subscriberQueueHardLimit` 时移除 subscriber 并调用 `subscriber.wake?.()` 触发 abort
  验证：`npm run build` 编译通过；`npm test -- ...agent-runtime` queue 高水位 drop 测试通过
  来源：spec「订阅者队列高水位」、design D2
- [x] 2.3 在 `publishLiveTimelineEvent` 的 `subscriber.queue.push(liveEvent)` 前添加相同的高水位检查
  验证：`npm run build` 编译通过；code review 确认与 publishTimelineEvent 逻辑一致
  来源：spec「订阅者队列高水位」、design D2

## 3. 空闲超时

- [x] 3.1 在 `agent-runtime/src/lifecycle/submit.ts` 新增 `subscriberIdleTimeoutMs = 300_000` 常量，在 `nextSubscriberEvent` 中将 `new Promise(resolve => {...})` 包装为 `Promise.race([waitPromise, timeoutPromise])`，超时返回 `undefined`，并在返回后 `clearTimeout` 避免泄漏
  验证：`npm run build` 编译通过；`npm test -- ...agent-runtime` 空闲超时测试通过（模拟队列空等待超时后 subscriber 被关闭）
  来源：spec「Stream subscriber 空闲超时」、design D3

## 4. Timeline 重放限制与 abort 检查

- [x] 4.1 在 `agent-runtime/src/lifecycle/submit.ts` 新增 `maxReplayTotalEvents = 10000` 和 `maxReplayDurationMs = 30_000` 常量
  验证：`npm run build` 编译通过
  来源：spec「Timeline 重放总量限制」、design D4
- [x] 4.2 在 `streamOwned` 的 `while(true)` 重放循环中添加：循环外初始化 `replayedCount` 和 `replayStartTime`；每批读取后累加 `replayedCount` 并检查上限；每批读取后检查 `Date.now() - replayStartTime` 时间上限；每批读取后检查 `request.signal?.aborted`（静默 return，不抛 error）
  验证：`npm run build` 编译通过；`npm test -- ...agent-runtime` 重放总量上限测试通过（构造超过 10000 事件的 session 断言抛 safe error）；abort 测试通过（模拟 signal abort 后重放循环退出）
  来源：spec「Timeline 重放总量限制」、design D4

## 5. LRU 缓存淘汰

- [x] 5.1 在 `agent-session/src/services/category-question-catalog.ts` 新增 `maxCacheEntries = 64` 常量，将 `cache = new Map<string, CatalogCacheEntry>()` 的 `get` 操作改为 delete + re-set（移到末尾），`set` 操作后检查 `size > maxCacheEntries` 时删除第一个条目（`cache.keys().next().value`）
  验证：`npm run build` 编译通过；`npm test -- ...agent-session` LRU 淘汰测试通过（填充超过 64 条后最旧条目被淘汰）
  来源：spec「内存 Catalog LRU 淘汰」、design D5

## 6. 验证和收尾

- [x] 6.1 后端常规验证：仓库根目录运行 `npm run build`
  验证：编译通过
  来源：AGENTS.md 验证门禁
- [x] 6.2 OpenSpec 验证：运行 `openspec validate --all --strict`
  验证：命令通过
  来源：AGENTS.md 验证门禁
- [x] 6.3 清理检查：确认本 change 未引入配置项、未使用的 helper/export 或 test-only 残留；所有上限为固定常量来源
  验证：diff code review 检查点
  来源：design 非目标、AGENTS.md 实现质量门禁


## 7. Pending input 空闲超时豁免

- [x] 7.1 在 TimelineStreamSubscriber 接口添加 pendingInputActive: boolean 字段
  验证：`npm run build` 编译通过
  来源：spec「Stream subscriber 空闲超时 pending input 豁免」、design D6
- [x] 7.2 在 subscriber 构造处（streamOwned 和 streamLiveTailOwned）初始化 pendingInputActive: false
  验证：`npm run build` 编译通过
  来源：design D6
- [x] 7.3 在 publishTimelineEvent 的 subscriber.queue.push(liveEvent) 后，根据 liveEvent.type 设置 pendingInputActive：USER_INPUT_REQUIRED 设 true，USER_INPUT_RECEIVED/USER_INPUT_TIMEOUT/USER_INPUT_CANCELED 设 false
  验证：`npm run build` 编译通过
  来源：design D6
- [x] 7.4 在 streamOwned 重放循环中追踪 pending input 状态（遍历到 USER_INPUT_REQUIRED 设 true，resolve 类事件设 false），replay 结束后赋值给 subscriber.pendingInputActive
  验证：`npm run build` 编译通过
  来源：design D6
- [x] 7.5 在 `nextSubscriberEvent` 中，当 `subscriber.pendingInputActive` 为 true 时跳过 `subscriberIdleTimeoutMs` 超时分支（仅保留 `waitPromise` + `signal.aborted`）
  验证：`npm run build` 编译通过；code review 确认 pending input 期间不会被空闲超时关闭
  来源：design D6

## 8. lastSeenSequence=0 跳过重放

- [x] 8.1 在 streamEvents 方法中，将 lastSeenSequence === undefined 的判断改为 filter-aware 路由：lastSeenSequence === undefined || (Number(lastSeenSequence) === 0 && !hasFilters)，使无 filter 的 0 走 live-tail 路径；有 filter 的 0 走重放路径（受 D4 限制）
  验证：`npm run build` 编译通过
  来源：spec「Timeline 重放 lastSeenSequence=0 跳过」、design D7
- [x] 8.2 在 stream 方法（RuntimeEventStreamPort.stream）中做相同 filter-aware 处理：Number(lastSeenSequence) === 0 && !hasFilters 时走 streamLiveTailOwned，否则走 streamOwned 重放
  验证：`npm run build` 编译通过
  来源：design D7
## 归档前更新基线检查（非实施任务）

实现完成并验证通过后，在归档前根据 proposal/design 的「归档前更新基线」处理：

- `openspec/specs/ts-web-sse-ws-transports/spec.md`：合并连接数限制、空闲超时和队列高水位 requirement。
- `openspec/specs/ts-stream-resume-replay/spec.md`：合并重放总量限制和 abort 检查 requirement。
- `openspec/specs/category-question-source/spec.md`：合并 LRU 淘汰 requirement。
- `openspec/overview.md`：安全边界描述补充 stream 资源限制加固。
- `openspec/designs/modules/`：`agent-runtime` 与 `agent-session` 模块设计补充对应常量和策略。
- `openspec/designs/spec-to-design-map.md`：新增 `harden-stream-resource-limits` 导航。
