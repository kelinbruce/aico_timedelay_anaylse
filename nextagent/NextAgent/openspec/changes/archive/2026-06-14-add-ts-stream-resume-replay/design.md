## 背景和现状（Context）

当前代码已经有 Web stream transport、runtime session-facing stream facade、conversation top-level `activeRun?` 和前端 stream hook。这个 design 只规定最小黑盒恢复策略，不重新设计 runtime、channel、history 或 terminal result 架构。

## 设计决策（Decisions）

### 1. `lastSeenSequence` 只作为页面内存 cursor

`lastSeenSequence` 表示当前页面生命周期内已经成功接收并展示的最大 timeline-backed `StreamEnvelope.sequence`。它只用于页面未刷新的断线重连。

页面刷新、新 tab 和换电脑打开会话时，前端不得读取 sessionStorage 或其他持久化 cursor 作为 stream resume anchor。刷新后的恢复必须先读取 conversation bootstrap。

黑盒效果：

```text
同一页面断线:
  内存 lastSeenSequence=N
  -> replay sequence > N
  -> 接 live

页面刷新/新设备:
  无内存 cursor
  -> 拉 conversation bootstrap
  -> 如有 activeRun，则 activeRun + lastSeenSequence=0
  -> replay 当前 active run
  -> 接 live
```

### 2. 页面刷新和新设备统一用 `activeRun + lastSeenSequence=0`

当 conversation bootstrap 返回 `activeRun { requestId, runId, status }` 时，前端必须用 `activeRun.requestId`、`activeRun.runId` 和 `lastSeenSequence=0` 打开 run-scoped stream。

这个路径用于恢复当前 active run 已经生成、但尚未 terminal commit 为 visible `SessionMessage` 的用户可见 stream 内容。它不能从历史消息扫描 current run，也不能依赖旧设备或旧页面的 cursor。

`requestId` 和 `runId` 只作为过滤条件；sequence 仍是 session-scoped，不允许重置为 run-scoped sequence。

### 3. 已提交历史和当前运行中内容分开恢复

已提交历史内容只通过 conversation history 的 visible `SessionMessage` 恢复。当前 active run 的未提交 stream 内容只通过 `activeRun` scoped replay 恢复。

Web channel、frontend sessionStorage、已发送 envelope、projection cache 和 channel replay buffer 都不是执行事实来源。

### 4. gap/failure 不推进 cursor

如果 runtime 无法安全 replay，必须返回既有 safe details：

- stream 已建立后的 gap 使用 `DEGRADATION_NOTICE.payload` 承载 `STREAM_RESUME_GAP`。
- handshake 或建立前失败使用 `SafeError.safeDetails` 承载 `STREAM_RESUME_FAILURE`。

收到 gap/failure 后，前端不得推进 cursor，不得把空 replay 当作成功。前端必须刷新同一 session 的 visible conversation；只有 refresh 成功后，下一次 resume 才能使用 `resumeAfterSequence`。

refresh 失败时，前端继续保留当前页面最后成功接收的 timeline-backed sequence，并显示降级或失败提示。

### 5. SSE 和 WebSocket 只差 transport framing

SSE reconnect 和 WebSocket connection/handshake 承载同样的 resume 输入：`sessionId`、`lastSeenSequence`、可选 `requestId`、可选 `runId`。两者必须进入同一 runtime session-facing stream path，不能分叉出两套恢复语义。

## 放弃方案

- 放弃 sessionStorage 持久化 stream cursor。它会让页面刷新后跳过当前 active run 已生成但尚未提交的内容。
- 放弃在本 change 中定义 terminal result consistency。
- 放弃后台修复 job、channel-owned replay buffer、history 专用事实表、retention window 和 large payload 协议。
- 放弃把 batch、timeout、backpressure、audit/metric 细节作为本 change 的黑盒要求。

## 验证策略

- Hook/unit tests：断线重连使用内存 cursor；刷新/新设备忽略 legacy sessionStorage cursor；`activeRun + lastSeenSequence=0` 恢复当前 run；gap refresh 成功后才使用 `resumeAfterSequence`。
- Transport tests：SSE 和 WebSocket 对同一 resume 输入构造等价连接参数。
- Page/store tests：conversation bootstrap 的 `activeRun` 被保留并传给 stream hook；页面恢复不依赖 sessionStorage stream cursor。
