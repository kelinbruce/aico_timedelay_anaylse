## ADDED Requirements

### Requirement: SSE 流交付订阅者清理

Web stream delivery 的 `deliverWebStream` 函数 MUST 在 `finally` 块中调用 runtime timeline iterator 的 `return?.()` 方法，确保 generator 的内部 `finally` 块（包含 `removeStreamSubscriber`）在 disconnect、abort 或 normal completion 时被执行。`iterator` 变量 MUST 声明在 `try` 块之前，使 `finally` 块能够安全引用。`return?.()` 调用 MUST 使用 optional chaining 防止 iterator 未初始化时抛错，且 MUST NOT 等待返回的 Promise（`finally` 块不能 `await`）。

当 stream connection 因 client disconnect、transport timeout、server shutdown 或 abort signal 触发而结束时，Web channel MUST 清理对 `RuntimeSessionPort.streamEvents(request)` 的订阅。清理 MUST NOT 产生 `REQUEST_COMPLETED`、`REQUEST_FAILED`、`REQUEST_CANCELED` 或 `REQUEST_SUPERSEDED` terminal event，MUST NOT 改变 RequestRun status 或 canonical timeline。

#### Scenario: disconnect 时清理订阅者

- **WHEN** SSE client 在 stream delivery 进行中断开连接
- **THEN** `deliverWebStream` 的 `finally` 块 MUST 调用 `iterator.return?.()`
- **AND** generator 内部的 `removeStreamSubscriber` MUST 被执行
- **AND** subscriber MUST 从 `streamSubscribers` Map 中移除

#### Scenario: abort 时清理订阅者

- **WHEN** abort signal 在 stream delivery 进行中被触发
- **THEN** `deliverWebStream` 的 `finally` 块 MUST 调用 `iterator.return?.()`
- **AND** subscriber MUST 被清理
- **AND** cleanup MUST NOT 产生 terminal event

#### Scenario: normal completion 时清理订阅者

- **WHEN** stream delivery 因 runtime terminal event 正常完成
- **THEN** `deliverWebStream` 的 `finally` 块 MUST 调用 `iterator.return?.()`
- **AND** subscriber MUST 被清理
- **AND** cleanup MUST NOT 改变 RequestRun status 或 canonical timeline

### Requirement: WebSocket 帧大小限制

Task channel WebSocket adapter MUST 对客户端发送的帧 payload 大小强制执行固定上限。单个帧 payload MUST NOT 超过 1 MiB（1048576 字节）。控制帧（opcode >= 0x8）payload MUST NOT 超过 125 字节，符合 RFC 6455 §5.5。

当帧 payload 超过 1 MiB 时，adapter MUST 发送 WebSocket close frame（code 1009 Message Too Big）并关闭连接。当控制帧 payload 超过 125 字节时，adapter MUST 发送 WebSocket close frame（code 1002 Protocol Error）并关闭连接。帧大小上限为固定常量，系统 MUST NOT 从 client payload 或配置读取或覆盖上限值。

#### Scenario: 帧 payload 超过 1 MiB 被拒绝

- **WHEN** WebSocket client 发送 payload 大小超过 1 MiB 的帧
- **THEN** adapter MUST 发送 close frame（code 1009）
- **AND** adapter MUST 关闭连接
- **AND** adapter MUST NOT 处理该帧的 payload

#### Scenario: 控制帧 payload 超过 125 字节被拒绝

- **WHEN** WebSocket client 发送 ping 或 pong 帧且 payload 超过 125 字节
- **THEN** adapter MUST 发送 close frame（code 1002）
- **AND** adapter MUST 关闭连接

#### Scenario: 合法大小帧被接受

- **WHEN** WebSocket client 发送 payload 大小不超过 1 MiB 的数据帧
- **THEN** adapter MUST 正常处理该帧

### Requirement: WebSocket pong 背压处理

Task channel WebSocket adapter 在响应客户端 ping 帧发送 pong 时，MUST 检查 pong 帧写入的背压信号。当 pong 帧写入失败（socket buffer 已满或返回 false）时，adapter MUST 发送 WebSocket close frame（code 1011 Internal Error）并关闭连接。`sendWebSocketPong` MUST 返回 `writeWebSocketFrame` 的背压信号（`boolean`），不得丢弃该信号。

#### Scenario: pong 写入成功

- **WHEN** WebSocket client 发送 ping 帧
- **AND** pong 帧写入成功
- **THEN** adapter MUST 发送 pong 帧
- **AND** 连接 MUST 保持打开

#### Scenario: pong 写入失败关闭连接

- **WHEN** WebSocket client 发送 ping 帧
- **AND** pong 帧写入失败（背压信号为 false）
- **THEN** adapter MUST 发送 close frame（code 1011）
- **AND** adapter MUST 关闭连接
- **AND** adapter MUST NOT 继续排队未发送的 pong 帧