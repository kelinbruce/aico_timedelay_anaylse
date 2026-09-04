## 1. 最小恢复行为

- [x] 1.1 将前端 stream cursor 改为页面生命周期内的内存 `lastSeenSequence`，不再用 sessionStorage 作为刷新后的恢复锚点。
- [x] 1.2 保留同一页面内断线重连：已接收 timeline-backed sequence 后，重连只请求 `sequence > lastSeenSequence`。
- [x] 1.3 保留刷新/新设备恢复：conversation bootstrap 返回 `activeRun` 时，用 `activeRun.requestId + activeRun.runId + lastSeenSequence=0` 恢复当前 active run。
- [x] 1.4 保留 gap/failure cursor 规则：gap/failure 不推进 cursor，refresh 成功后才使用 `resumeAfterSequence`，refresh 失败保持降级提示。
- [x] 1.5 验证 SSE/WebSocket 使用同一 resume 输入语义，不因 transport 切换改变 sequence 或重新执行请求。

## 2. 归档准备

- [x] 2.1 补齐 `MODIFIED` delta spec，使 archive 后不会覆盖或删除既有 baseline requirement 场景。
- [x] 2.2 对齐相关 OpenSpec 文档中的 runtime session-facing stream contract 名称。
- [x] 2.3 在临时副本执行 archive dry run，并验证真实仓库不产生 archive 目录。
