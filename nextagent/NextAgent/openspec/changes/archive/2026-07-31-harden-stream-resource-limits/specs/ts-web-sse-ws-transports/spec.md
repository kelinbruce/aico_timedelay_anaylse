## ADDED Requirements

### Requirement: Stream subscriber 连接数限制

Runtime timeline stream 管理 MUST 限制同一 stream key（`tenantId + subjectId + agentId + sessionId`）上的活跃 subscriber 数量不超过 `maxSubscribersPerStream`（10）。`addStreamSubscriber` MUST 在 `subscribers.add(subscriber)` 之前检查 `subscribers.size`，超限时 MUST 抛 `AgentError`（`code: "STREAM_SUBSCRIBER_LIMIT_EXCEEDED"`, `category: "UNAVAILABLE"`, `retryable: true`），MUST NOT 将 subscriber 加入 Set。连接数上限为固定常量，系统 MUST NOT 从 client payload、client metadata 或配置读取或覆盖上限值。

SSE transport 收到该 error 后 MUST 返回 HTTP 503 Service Unavailable safe error。WebSocket transport 收到该 error 后 MUST 发送 close frame（code 1013 Try Again Later）并关闭连接。

#### Scenario: 超限连接被拒绝

- **WHEN** 某 stream key 已有 10 个活跃 subscriber，第 11 个连接尝试订阅
- **THEN** `addStreamSubscriber` MUST 抛 `STREAM_SUBSCRIBER_LIMIT_EXCEEDED` error
- **AND** subscriber MUST NOT 被加入 `streamSubscribers` Set
- **AND** SSE transport MUST 返回 HTTP 503
- **AND** WebSocket transport MUST 发送 close frame 1013 并关闭连接

#### Scenario: 边界值连接被接受

- **WHEN** 某 stream key 已有 9 个活跃 subscriber，第 10 个连接尝试订阅
- **THEN** `addStreamSubscriber` MUST 接受订阅
- **AND** subscriber MUST 被加入 `streamSubscribers` Set

#### Scenario: subscriber 移除后可重新订阅

- **WHEN** 某 stream key 已有 10 个活跃 subscriber，其中一个 subscriber 因 disconnect 被移除后，新连接尝试订阅
- **THEN** `addStreamSubscriber` MUST 接受订阅
- **AND** subscriber MUST 被加入 `streamSubscribers` Set

### Requirement: 订阅者队列高水位

Runtime timeline stream 管理 MUST 限制每个 subscriber 的 queue 长度，防止慢消费者导致内存无界增长。`publishTimelineEvent` 和 `publishLiveTimelineEvent` MUST 在 `subscriber.queue.push(liveEvent)` 之前检查 `queue.length`：

- 当 `queue.length >= maxSubscriberQueueEvents`（1000）且事件 `persistence` 为 `LIVE_ONLY` 时，MUST 跳过 push（静默丢弃）。
- 当 `queue.length >= maxSubscriberQueueEvents`（1000）且事件 `persistence` 为 `PERSISTED` 时，MUST 仍然 push（持久化事件不可丢失）。
- 当 `queue.length >= subscriberQueueHardLimit`（2000）时，MUST 移除该 subscriber 并调用 `subscriber.wake?.()` 触发 abort，live-tail 循环 MUST 退出。

队列高水位为固定常量，系统 MUST NOT 从 client payload、client metadata 或配置读取或覆盖阈值。

#### Scenario: LIVE_ONLY 事件在 soft limit 被丢弃

- **WHEN** 某 subscriber 的 queue 长度达到 1000
- **AND** `publishTimelineEvent` 或 `publishLiveTimelineEvent` 尝试 push 一个 `LIVE_ONLY` 事件
- **THEN** 该事件 MUST 被跳过（不 push）
- **AND** subscriber MUST NOT 被移除
- **AND** subscriber MUST 继续接收后续 PERSISTED 事件

#### Scenario: PERSISTED 事件在 soft limit 仍然 push

- **WHEN** 某 subscriber 的 queue 长度达到 1000
- **AND** `publishTimelineEvent` 尝试 push 一个 `PERSISTED` 事件
- **THEN** 该事件 MUST 被 push 到 queue
- **AND** subscriber MUST NOT 被移除

#### Scenario: 超过 hard limit 时关闭 subscriber

- **WHEN** 某 subscriber 的 queue 长度达到 2000
- **AND** `publishTimelineEvent` 或 `publishLiveTimelineEvent` 尝试 push 事件
- **THEN** subscriber MUST 被从 `streamSubscribers` Set 中移除
- **AND** `subscriber.wake?.()` MUST 被调用
- **AND** live-tail 循环 MUST 退出

### Requirement: Stream subscriber 空闲超时

Runtime timeline stream 管理 MUST 为 live-tail subscriber 设置服务端空闲超时。`nextSubscriberEvent` 在队列空时 MUST NOT 无限等待。当 subscriber 连续等待事件的时间超过 `subscriberIdleTimeoutMs`（300000ms / 5 分钟）时，`nextSubscriberEvent` MUST 返回 `undefined`，live-tail 循环 MUST 退出，transport 层 MUST 关闭连接。

空闲超时为固定常量，系统 MUST NOT 从 client payload、client metadata 或配置读取或覆盖超时值。超时定时器 MUST 在 `nextSubscriberEvent` 返回后（无论因事件到达、signal abort 还是超时）被 `clearTimeout` 清理，MUST NOT 泄漏。

#### Scenario: 空闲超时关闭连接

- **WHEN** live-tail subscriber 的队列连续空等待超过 5 分钟
- **THEN** `nextSubscriberEvent` MUST 返回 `undefined`
- **AND** live-tail 循环 MUST 退出
- **AND** transport 层 MUST 关闭连接

#### Scenario: 事件到达重置等待

- **WHEN** subscriber 在超时窗口内收到新事件
- **THEN** `nextSubscriberEvent` MUST 返回该事件
- **AND** 超时定时器 MUST 被清理
- **AND** live-tail 循环 MUST 继续等待下一个事件

#### Scenario: signal abort 优先于超时

- **WHEN** subscriber 正在等待事件，且 `request.signal` 被 abort
- **THEN** `nextSubscriberEvent` MUST 返回 `undefined`
- **AND** 超时定时器 MUST 被清理
- **AND** 超时定时器 MUST NOT 在 abort 后触发

### Requirement: Stream subscriber 空闲超时 pending input 豁免

Runtime timeline stream 管理 MUST 在 subscriber 处于 pending input 等待状态时豁免空闲超时。当 `subscriber.pendingInputActive` 为 true 时，`nextSubscriberEvent` MUST NOT 触发 `subscriberIdleTimeoutMs` 超时，仅依赖 `request.signal?.aborted` 退出。

pendingInputActive 状态 MUST 由以下事件驱动：
- publishTimelineEvent 推送 USER_INPUT_REQUIRED 事件后 MUST 设置 subscriber.pendingInputActive = true。
- publishTimelineEvent 推送 USER_INPUT_RECEIVED、USER_INPUT_TIMEOUT 或 USER_INPUT_CANCELED 事件后 MUST 设置 subscriber.pendingInputActive = false。
- streamOwned 重放循环中遍历到上述事件时 MUST 同步更新局部状态变量，replay 结束后 MUST 将最终值赋给 subscriber.pendingInputActive。

#### Scenario: pending input 期间不触发空闲超时

- **WHEN** subscriber 收到 USER_INPUT_REQUIRED 事件后，队列连续空闲超过 5 分钟
- **THEN** `nextSubscriberEvent` MUST NOT 返回 undefined
- **AND** 连接 MUST NOT 被关闭
- **AND** subscriber MUST 继续等待事件

#### Scenario: pending input resolve 后恢复空闲超时

- **WHEN** subscriber 收到 USER_INPUT_RECEIVED 事件后，队列连续空闲超过 5 分钟
- **THEN** `nextSubscriberEvent` MUST 返回 undefined
- **AND** 连接 MUST 被关闭

#### Scenario: 重放路径恢复 pending input 状态

- **WHEN** subscriber 重连时重放历史事件，最后一个 pending input 事件为 USER_INPUT_REQUIRED（未收到 resolve 事件）
- **THEN** replay 结束后 subscriber.pendingInputActive MUST 为 true
- **AND** 后续 live-tail 等待 MUST 豁免空闲超时
