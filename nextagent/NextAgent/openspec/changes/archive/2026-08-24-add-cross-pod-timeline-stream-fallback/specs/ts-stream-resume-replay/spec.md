## ADDED Requirements

### Requirement: 跨 Pod Timeline DB 回退轮询

在 SSE 连接和 request 处理可能落在不同 pod 的多 pod 部署中，`publishTimelineEvent` 只向进程内订阅者投递事件。Runtime stream live 阶段 SHALL 在进程内订阅者空闲时轮询 timeline DB，以恢复其他 pod 持久化的事件。

轮询间隔 SHALL 为 `crossPodPollIntervalMs`（2000ms）。当进程内订阅者在该间隔内未返回事件时，runtime SHALL 以等于 `subscriber.lastSeenSequence` 的 `afterSequence` 查询 timeline DB，以获取其他 pod 持久化的增量事件。已见过的事件（`sequence <= lastSeenSequence`）SHALL 被跳过以避免重复投递。连续 `crossPodMaxIdlePolls` 次空闲轮询且无 DB 事件后，stream SHALL 结束。

#### Scenario: Stream 恢复其他 pod 持久化的事件

- **WHEN** 一个 request 在 pod A 上处理且其 timeline 事件被持久化到 DB
- **AND** pod B 上的一个 SSE 连接订阅了同一 session timeline
- **THEN** pod B 的进程内订阅者在 `crossPodPollIntervalMs` 内未收到事件
- **AND** pod B 轮询 DB 并收到 `sequence > lastSeenSequence` 的事件
- **AND** pod B 将这些事件投递到 SSE stream
- **AND** pod B 重置空闲轮询计数器

#### Scenario: Stream 在空闲上限后结束

- **WHEN** 进程内订阅者和 DB 轮询都未产生新事件
- **AND** 连续空闲轮询达到 `crossPodMaxIdlePolls`
- **THEN** stream SHALL 优雅结束

#### Scenario: DB 回退不产生重复投递

- **WHEN** DB 回退返回已通过进程内订阅者投递过的事件
- **THEN** `sequence <= subscriber.lastSeenSequence` 的事件 SHALL 被跳过
- **AND** 只有 `sequence > lastSeenSequence` 的事件 SHALL 被投递


#### Scenario: DB 轮询超时降级为空闲

- **WHEN** timeline DB 查询在跨 pod 回退期间超时或失败
- **THEN** runtime SHALL 返回空闲状态而不中断 SSE stream
- **AND** 空闲轮询计数器 SHALL 正常推进
- **AND** stream SHALL 在下一个间隔继续轮询
### Requirement: 跨 Pod Pending Input 状态同步

当 DB 回退投递 `USER_INPUT_REQUIRED`、`USER_INPUT_RECEIVED`、`USER_INPUT_TIMEOUT` 或 `USER_INPUT_CANCELED` 事件时，订阅者的 `pendingInputActive` 标志 SHALL 被更新以与进程内 `publishTimelineEvent` 行为一致。这确保 `nextSubscriberEvent` 在 DB 回退投递之后应用正确的空闲超时策略。

#### Scenario: DB 回退在 USER_INPUT_REQUIRED 时设置 pendingInputActive

- **WHEN** DB 回退投递一个 `USER_INPUT_REQUIRED` 事件
- **THEN** `subscriber.pendingInputActive` SHALL 被设置为 `true`


#### Scenario: DB 回退在等待期间解除 pending input

- **WHEN** 订阅者正在等待且 ``pendingInputActive`` 被设置为 ``true``
- **AND** 另一个 pod 向 DB 持久化一个 ``USER_INPUT_RECEIVED`` 事件
- **THEN** stream SHALL 在 pending 等待期间继续轮询 DB
- **AND** ``USER_INPUT_RECEIVED`` 事件 SHALL 通过 DB 回退投递
- **AND** ``subscriber.pendingInputActive`` SHALL 被清除为 ``false``
#### Scenario: DB 回退在解除事件时清除 pendingInputActive

- **WHEN** DB 回退投递 `USER_INPUT_RECEIVED`、`USER_INPUT_TIMEOUT` 或 `USER_INPUT_CANCELED`
- **THEN** `subscriber.pendingInputActive` SHALL 被设置为 `false`

### Requirement: 跨 Pod Stream Sequence 高水位维护

在 DB 回退投递事件之后，runtime SHALL 调用 `rememberStreamSequence` 更新 stream 高水位。这为同一 pod 上后续订阅者连接保持 sequence 连续性。

#### Scenario: DB 回退事件后更新高水位

- **WHEN** DB 回退投递一个或多个事件
- **THEN** SHALL 以更新后的 `subscriber.lastSeenSequence` 调用 `rememberStreamSequence(streamKey, lastSeenSequence)`