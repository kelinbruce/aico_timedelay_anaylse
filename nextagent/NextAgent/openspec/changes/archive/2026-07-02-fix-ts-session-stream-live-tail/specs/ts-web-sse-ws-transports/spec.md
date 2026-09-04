## ADDED Requirements

### Requirement: 无 cursor 的 session stream 使用 live tail
TS Web stream transport SHALL 区分省略的 `lastSeenSequence` 查询参数与显式数字 `lastSeenSequence`。当一个 session 级 stream 不带 `lastSeenSequence`、`requestId` 或 `runId` 时，Web channel 和 runtime MUST 把它当作 session live-tail 处理，MUST NOT 重放既有 session timeline 历史。

#### Scenario: 无 cursor 的 session stream 不重放既有历史
- **WHEN** 客户端为某个可见 session 打开不带 `lastSeenSequence`、`requestId` 或 `runId` 的 SSE 或 WebSocket stream
- **THEN** Web channel MUST NOT 合成 `lastSeenSequence=0`
- **AND** runtime MUST 从当前 session 尾部开始订阅
- **AND** 该 session 之前已持久化的 stream 可见 timeline event MUST NOT 被发射到该 stream 连接
- **AND** live-tail 边界之后的新 session event 仍 MUST 按 session 级 stream 规则发射

#### Scenario: 显式零仍然是完整 session 重放
- **WHEN** 客户端以 `lastSeenSequence=0` 且不带 `requestId/runId` 过滤打开 SSE 或 WebSocket stream
- **THEN** Web channel MUST 向 runtime 传递数字 cursor `0`
- **AND** runtime MUST 从 session timeline 开头使用既有 session 级重放语义
- **AND** 该显式重放行为 MUST NOT 被无 cursor 的 live-tail 行为改变

#### Scenario: 从零开始的 run 级重放仍受过滤约束
- **WHEN** 客户端以 `lastSeenSequence=0` 和一个可见的 `requestId` 或 `runId` 打开 SSE 或 WebSocket stream
- **THEN** runtime MUST 重放 session timeline sequence `0` 之后匹配所提供过滤条件的可恢复事件
- **AND** `requestId/runId` MUST 保持为过滤条件，MUST NOT 重置 sequence 编号

#### Scenario: 无 cursor 的过滤恢复安全失败
- **WHEN** 客户端带 `requestId` 或 `runId` 但不带 `lastSeenSequence` 打开 SSE 或 WebSocket stream
- **THEN** Web channel 或 runtime MUST 安全拒绝该 stream
- **AND** 该失败 MUST NOT 暴露 raw owner scope、agent scope、本地路径、prompt、模型输出或 timeline payload 内容

### Requirement: 可选 cursor 语义在传输层等价
SSE 和 WebSocket stream 传输 SHALL 对省略 cursor、显式数字 cursor 以及 request/run 过滤应用完全相同的查询解析。

#### Scenario: 省略的 cursor 在各传输 adapter 中保持省略
- **WHEN** 客户端打开不带 `lastSeenSequence` 的 SSE 或 WebSocket stream
- **THEN** 对应的 Web stream delivery 请求 MUST 保持 `lastSeenSequence` 为省略
- **AND** SSE adapter 和 WebSocket adapter MUST NOT 把省略转换为 `0`

#### Scenario: 无效的显式 cursor 安全失败
- **WHEN** 客户端打开的 SSE 或 WebSocket stream 带有 `lastSeenSequence` 但不是非负 safe integer
- **THEN** Web channel MUST 安全地使校验失败
- **AND** 该失败 MUST NOT 暴露 raw owner scope、agent scope、本地路径、prompt、模型输出或 timeline payload 内容
