## ADDED Requirements

### Requirement: Timeline 重放总量限制

Runtime timeline stream 的 `streamOwned` 重放循环 MUST 限制全量重放的总事件数和总时间，防止超大 session 的 `?lastSeenSequence=0` 请求耗尽 CPU 和内存。重放循环 MUST 在循环外初始化 `replayedCount`（已重放事件计数）和 `replayStartTime`（重放开始时间戳），并在每批 timeline 事件读取后检查：

- 当 `replayedCount` 超过 `maxReplayTotalEvents`（10000）时，MUST 抛 `AgentError`（`code: "STREAM_REPLAY_LIMIT_EXCEEDED"`, `category: "UNAVAILABLE"`, `retryable: true`）。
- 当 `Date.now() - replayStartTime` 超过 `maxReplayDurationMs`（30000ms）时，MUST 抛相同的 safe error。

重放总量限制为固定常量，系统 MUST NOT 从 client payload、client metadata 或配置读取或覆盖上限值。

#### Scenario: 重放事件数超限

- **WHEN** session timeline 事件数超过 10000，客户端以 `lastSeenSequence=0` 请求全量重放
- **THEN** 重放循环 MUST 在 `replayedCount` 超过 10000 时抛 `STREAM_REPLAY_LIMIT_EXCEEDED`
- **AND** error MUST 为 `retryable: true`
- **AND** transport 层 MUST 返回 safe error 并关闭连接

#### Scenario: 重放时间超限

- **WHEN** 重放循环执行时间超过 30 秒（如 timeline store 查询缓慢）
- **THEN** 重放循环 MUST 在时间检查时抛 `STREAM_REPLAY_LIMIT_EXCEEDED`
- **AND** error MUST 为 `retryable: true`

#### Scenario: 正常重放不受影响

- **WHEN** session timeline 事件数不超过 10000，重放时间不超过 30 秒
- **THEN** 重放循环 MUST 正常完成
- **AND** MUST NOT 抛 `STREAM_REPLAY_LIMIT_EXCEEDED`

### Requirement: Timeline 重放 abort 检查

Runtime timeline stream 的 `streamOwned` 重放循环 MUST 在每批 timeline 事件读取后检查 `request.signal?.aborted`。当 client disconnect、transport timeout 或 server shutdown 触发 abort signal 时，重放循环 MUST 静默退出（`return`），MUST NOT 抛 error，MUST NOT 产生 terminal event。此行为对齐 live-tail 循环已有的 `while (!request.signal?.aborted)` 检查模式。

#### Scenario: client disconnect 中断重放

- **WHEN** 重放循环进行中，client 断开连接触发 `request.signal.aborted`
- **THEN** 重放循环 MUST 在下一批读取后检测到 abort 并退出
- **AND** MUST NOT 抛 error
- **AND** MUST NOT 产生 terminal event

#### Scenario: 重放完成后 abort 不影响结果

- **WHEN** 重放循环正常完成（`records.length < maxReplayBatchEvents`），随后 abort signal 被触发
- **THEN** 重放已完成的事件 MUST 已正常 yield
- **AND** abort MUST NOT 影响已 yield 的事件

Runtime timeline stream 的 streamEvents 和 stream 方法 MUST 使用 filter-aware 路由处理 lastSeenSequence=0：当 lastSeenSequence=0 且无 requestId/runId filter 时，MUST 走 live-tail 路径（streamLiveTailOwned），不触发历史重放。当 lastSeenSequence=0 且有 filter 时（如 subagent-execution-port 使用 0 + requestId + runId 从头重放子请求事件），MUST 走 streamOwned 重放路径（受 maxReplayTotalEvents 和 maxReplayDurationMs 限制）。

streamEvents 方法中 lastSeenSequence=undefined 且无 filter 时 MUST 走 live-tail 路径，行为与 lastSeenSequence=0 且无 filter 一致。lastSeenSequence=undefined 且有 filter 时 MUST 抛 STREAM_REPLAY_ANCHOR_REQUIRED（filtered live-tail 无意义）。

非零 lastSeenSequence anchor 仍正常走重放路径，受 maxReplayTotalEvents 和 maxReplayDurationMs 限制。

客户端如需加载历史事件 MUST 使用 conversation history API 分页加载。

#### Scenario: lastSeenSequence=0 无 filter 走 live-tail

- **WHEN** 客户端以 lastSeenSequence=0 请求 stream
- **THEN** runtime MUST 走 streamLiveTailOwned 路径
- **AND** MUST NOT 进入 streamOwned 重放循环
- **AND** subscriber MUST 仅接收重连后产生的新事件

#### Scenario: lastSeenSequence=0 有 filter 走重放

- **WHEN** runtime 以 lastSeenSequence=0 且 requestId/runId filter 请求 stream（如 subagent-execution-port）
- **THEN** runtime MUST 走 streamOwned 重放路径
- **AND** 重放受 maxReplayTotalEvents 和 maxReplayDurationMs 限制

#### Scenario: lastSeenSequence=undefined 无 filter 走 live-tail

- **WHEN** 客户端未提供 lastSeenSequence 请求 stream
- **THEN** runtime MUST 走 streamLiveTailOwned 路径
- **AND** 行为 MUST 与 lastSeenSequence=0 一致

#### Scenario: 非零 lastSeenSequence 仍走重放

- **WHEN** 客户端以 lastSeenSequence=100 请求 stream
- **THEN** runtime MUST 走 streamOwned 重放路径
- **AND** MUST 从 sequence 101 开始重放
- **AND** 重放受 maxReplayTotalEvents 和 maxReplayDurationMs 限制